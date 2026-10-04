import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';
import { createCredentialsStore } from './credentials.mjs';
import { createIdempotencyStore } from './idempotency.mjs';
import { publishToLinkedIn } from '../providers/linkedin.mjs';
import { publishToFacebook } from '../providers/facebook.mjs';
import { publishToInstagram } from '../providers/instagram.mjs';
import { publishToWhapi } from '../providers/whapi.mjs';
import { createInstagramMediaStager } from '../providers/instagram-media.mjs';
import { createWhapiMediaStager } from '../providers/whapi-media.mjs';

// publishing-service — owns actual outbound publishing (provider payload
// creation, provider API calls, result normalization, durable idempotency,
// publishing history). Does NOT own OAuth/connect/disconnect (that's
// integrations-service), general media persistence (media-service), or
// scheduler timing (scheduler-service, not built yet).
//
// Credential resolution reads platform_connections/whatsapp_connections
// directly (same shared Postgres integrations-service already owns) rather
// than an HTTP round-trip per publish — see credentials.mjs's own comment
// for why that's a deliberate choice, not a shortcut.
//
// NOT ported: logSystem()'s writes to the monolith's `system_logs` table —
// publish_attempts (new table, this round) IS this service's publishing
// history per the brief ("do not create duplicate equivalent tables"); a
// second write into system_logs would be exactly that duplication the
// brief warns against. See MIGRATION-NOTES.md.

const PORT = Number(process.env.PORT || 4006);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const INSTAGRAM_MEDIA_ROOT = process.env.INSTAGRAM_MEDIA_ROOT || '/app/.instagram-media';
const WHAPI_MEDIA_ROOT = process.env.WHAPI_MEDIA_ROOT || '/app/.whapi-media';
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
const WHAPI_API_BASE = process.env.WHAPI_API_BASE || 'https://gate.whapi.cloud';
const WHAPI_API_TOKEN = process.env.WHAPI_API_TOKEN || '';
const PROVIDER_TIMEOUT_MS = 30_000;
const log = createLogger('publishing-service');

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.error({ event: 'pool_error', message: err.message }));
  return pool;
}
const poolProxy = { query: (...args) => getPool().query(...args) };
const credentials = createCredentialsStore(poolProxy);
const idempotency = createIdempotencyStore(poolProxy);
const prepareInstagramMedia = createInstagramMediaStager(INSTAGRAM_MEDIA_ROOT, APP_ORIGIN);
const prepareWhapiMedia = createWhapiMediaStager(WHAPI_MEDIA_ROOT, APP_ORIGIN);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function err(res, code, message, status, attemptId) {
  send(res, status, { success: false, code, message, attemptId });
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Provider request timed out')), ms)),
  ]);
}
const WHAPI_MEDIA_CONTENT_TYPE = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};
const STAGED_MEDIA_ID = /^[a-f0-9]{48}\.(png|jpg|webp|mp4|pdf)$/;

async function serveStagedMedia(req, res, root, id, contentType) {
  if (!STAGED_MEDIA_ID.test(id)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const file = join(root, id);
  let bytes;
  let info;
  try {
    [bytes, info] = await Promise.all([readFile(file), stat(file)]);
  } catch {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const headers = {
    'Content-Type': contentType,
    'Content-Length': String(info.size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  const range = req.headers.range;
  if (typeof range === 'string') {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : -1;
    const end = match?.[2] ? Number(match[2]) : bytes.length - 1;
    if (start < 0 || start > end || end >= bytes.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${bytes.length}` });
    res.end(bytes.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, headers);
  res.end(bytes);
}

async function handleLinkedIn(req, res, requestId) {
  const userId = requireActor(req);
  if (!userId) return err(res, 'PLATFORM_NOT_CONNECTED', 'Sign in required.', 401);
  const body = await readJsonBody(req);
  const { content, attemptId } = body;
  if (!content) return err(res, 'PUBLISH_FAILED', 'Post content is required.', 400, attemptId);
  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `att_${Date.now().toString(36)}`;

  const claim = await idempotency.claimAttempt({ attemptId: attempt, platform: 'linkedin', userId });
  if (claim.duplicate) return err(res, 'DUPLICATE_PUBLISH_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attempt);

  const auth = await credentials.getLinkedInAuth(userId);
  if (!auth) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'LINKEDIN_NOT_CONNECTED' });
    return err(res, 'LINKEDIN_NOT_CONNECTED', 'LinkedIn is not connected. Reconnect through OAuth before publishing.', 401, attempt);
  }

  try {
    const result = await withTimeout(publishToLinkedIn({ accessToken: auth.accessToken, providerUserId: auth.providerUserId, ...body, attempt }), PROVIDER_TIMEOUT_MS);
    await idempotency.recordResult(claim.id, result.ok ? { status: 'SUCCESS', providerPostId: result.postId } : { status: 'FAILED', errorCode: result.code });
    if (!result.ok) return err(res, result.code, result.message, result.status, attempt);
    log.info({ requestId, event: 'publish_success', platform: 'linkedin', userId, postId: result.postId });
    return send(res, 200, { success: true, postId: result.postId, attemptId: attempt, message: result.message });
  } catch (e) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'PUBLISH_FAILED' });
    log.error({ requestId, event: 'publish_error', platform: 'linkedin', userId, message: e instanceof Error ? e.message : 'unknown' });
    return err(res, 'PUBLISH_FAILED', 'LinkedIn publish failed or timed out.', 502, attempt);
  }
}

async function handleFacebook(req, res, requestId) {
  const userId = requireActor(req);
  if (!userId) return err(res, 'PLATFORM_NOT_CONNECTED', 'Sign in required.', 401);
  const body = await readJsonBody(req);
  const { content, pageId, attemptId } = body;
  if (!content) return err(res, 'PUBLISH_FAILED', 'Post content is required.', 400, attemptId);
  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `att_${Date.now().toString(36)}`;

  const claim = await idempotency.claimAttempt({ attemptId: attempt, platform: 'facebook', userId, destination: pageId });
  if (claim.duplicate) return err(res, 'DUPLICATE_PUBLISH_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attempt);

  const resolved = await credentials.getFacebookPageToken(userId, typeof pageId === 'string' ? pageId : undefined);
  if (!resolved) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'FACEBOOK_NOT_CONNECTED' });
    return err(res, 'FACEBOOK_NOT_CONNECTED', 'Facebook Page is not connected. Reconnect through OAuth before publishing.', 401, attempt);
  }

  try {
    const result = await withTimeout(publishToFacebook({ targetPageId: resolved.pageId, pageToken: resolved.token, ...body, attempt }), PROVIDER_TIMEOUT_MS);
    await idempotency.recordResult(claim.id, result.ok ? { status: 'SUCCESS', providerPostId: result.postId } : { status: 'FAILED', errorCode: result.code });
    if (!result.ok) return err(res, result.code, result.message, result.status, attempt);
    log.info({ requestId, event: 'publish_success', platform: 'facebook', userId, postId: result.postId });
    return send(res, 200, { success: true, postId: result.postId, attemptId: attempt });
  } catch (e) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'PUBLISH_FAILED' });
    log.error({ requestId, event: 'publish_error', platform: 'facebook', userId, message: e instanceof Error ? e.message : 'unknown' });
    return err(res, 'PUBLISH_FAILED', 'Facebook publish failed or timed out.', 502, attempt);
  }
}

async function handleInstagram(req, res, requestId) {
  const userId = requireActor(req);
  if (!userId) return err(res, 'PLATFORM_NOT_CONNECTED', 'Sign in required.', 401);
  const body = await readJsonBody(req);
  const { pageId, attemptId } = body;
  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `att_${Date.now().toString(36)}`;

  const claim = await idempotency.claimAttempt({ attemptId: attempt, platform: 'instagram', userId, destination: pageId });
  if (claim.duplicate) return err(res, 'DUPLICATE_PUBLISH_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attempt);

  const ig = await credentials.getInstagramAccount(userId, typeof pageId === 'string' ? pageId : undefined);
  if (!ig) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'INSTAGRAM_NOT_CONNECTED' });
    return err(res, 'INSTAGRAM_NOT_CONNECTED', 'No Instagram Business account is linked to the connected Facebook Page. Link one in Meta Business Suite, then reconnect.', 401, attempt);
  }

  try {
    const result = await withTimeout(publishToInstagram({ ig, ...body, attempt, prepareInstagramMedia }), PROVIDER_TIMEOUT_MS);
    await idempotency.recordResult(claim.id, result.ok ? { status: 'SUCCESS', providerPostId: result.postId } : { status: 'FAILED', errorCode: result.code });
    if (!result.ok) return err(res, result.code, result.message, result.status, attempt);
    log.info({ requestId, event: 'publish_success', platform: 'instagram', userId, postId: result.postId });
    return send(res, 200, { success: true, postId: result.postId, attemptId: attempt, mock: result.mock === true, message: result.message });
  } catch (e) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'PUBLISH_FAILED' });
    log.error({ requestId, event: 'publish_error', platform: 'instagram', userId, message: e instanceof Error ? e.message : 'unknown' });
    return err(res, 'PUBLISH_FAILED', 'Instagram publish failed or timed out.', 502, attempt);
  }
}

async function handleWhapi(req, res, requestId) {
  const userId = requireActor(req);
  if (!userId) return err(res, 'PLATFORM_NOT_CONNECTED', 'Sign in required.', 401);
  const body = await readJsonBody(req);
  const { groupId, attemptId } = body;
  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `whapi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const claim = await idempotency.claimAttempt({ attemptId: attempt, platform: 'whapi', userId, destination: groupId });
  if (claim.duplicate) return err(res, 'WHAPI_DUPLICATE_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attempt);

  if (!WHAPI_API_TOKEN) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'WHAPI_NOT_CONFIGURED' });
    return err(res, 'WHAPI_NOT_CONFIGURED', 'Whapi is not configured. Add WHAPI_API_TOKEN to .env.local.', 401, attempt);
  }

  // Single-channel ownership gate — same as the original: provider-connected
  // state is NOT ownership; the caller must be the recorded CONNECTED owner
  // of this exact shared channel token.
  const ownerUserId = await credentials.getWhatsAppChannelOwner(WHAPI_API_TOKEN);
  if (!ownerUserId) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'WHATSAPP_NOT_CHANNEL_OWNER' });
    return err(res, 'WHATSAPP_NOT_CHANNEL_OWNER', 'No WhatsApp account is connected to this workspace channel yet. Connect WhatsApp first.', 403, attempt);
  }
  if (ownerUserId !== userId) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'WHATSAPP_NOT_CHANNEL_OWNER' });
    return err(res, 'WHATSAPP_NOT_CHANNEL_OWNER', 'This WhatsApp number is connected to a different SocialPulse account. Only the account that paired it can publish.', 403, attempt);
  }

  try {
    const result = await withTimeout(
      publishToWhapi({ config: { baseUrl: WHAPI_API_BASE, token: WHAPI_API_TOKEN }, groupId, text: body.text, mediaList: body.mediaList, attempt, prepareWhapiMedia }),
      PROVIDER_TIMEOUT_MS,
    );
    await idempotency.recordResult(claim.id, result.ok ? { status: 'SUCCESS' } : { status: 'FAILED', errorCode: result.code });
    if (!result.ok) return err(res, result.code, result.message, result.status, attempt);
    log.info({ requestId, event: 'publish_success', platform: 'whatsapp', userId, destination: groupId });
    return send(res, 200, { success: true, message: result.message, attemptId: attempt, data: result.data });
  } catch (e) {
    await idempotency.recordResult(claim.id, { status: 'FAILED', errorCode: 'WHAPI_PUBLISH_FAILED' });
    log.error({ requestId, event: 'publish_error', platform: 'whatsapp', userId, message: e instanceof Error ? e.message : 'unknown' });
    return err(res, 'WHAPI_PUBLISH_FAILED', 'WhatsApp publish failed or timed out.', 502, attempt);
  }
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  // CRITICAL: every route below can throw (DB errors, bad input shapes,
  // etc.) — without this wrapper an uncaught rejection anywhere in a
  // handler crashes the WHOLE process (Node's default for an unhandled
  // promise rejection), taking down publishing for every in-flight user,
  // not just failing the one bad request. Found by an actual test: a
  // foreign-key violation in claimAttempt() crashed the service outright.
  // One failed request must never be able to do that.
  try {
    if (req.url === '/health') {
      return send(res, 200, { service: 'publishing-service', status: 'ok', timestamp: new Date().toISOString() });
    }
    const url = new URL(req.url, 'http://internal');
    const instagramMedia = url.pathname.match(/^\/instagram\/media\/([^/]+)$/);
    if (instagramMedia && req.method === 'GET') {
      const id = instagramMedia[1];
      return serveStagedMedia(req, res, INSTAGRAM_MEDIA_ROOT, id, id.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
    }
    const whapiMedia = url.pathname.match(/^\/whapi\/media\/([^/]+)$/);
    if (whapiMedia && req.method === 'GET') {
      const id = whapiMedia[1];
      const ext = id.split('.').pop();
      return serveStagedMedia(req, res, WHAPI_MEDIA_ROOT, id, WHAPI_MEDIA_CONTENT_TYPE[ext] || 'application/octet-stream');
    }
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }

    if (req.method !== 'POST') return send(res, 404, { code: 'NOT_FOUND', message: 'No such publishing-service route.' });

    if (url.pathname === '/linkedin') return await handleLinkedIn(req, res, requestId);
    if (url.pathname === '/facebook') return await handleFacebook(req, res, requestId);
    if (url.pathname === '/instagram') return await handleInstagram(req, res, requestId);
    if (url.pathname === '/whapi') return await handleWhapi(req, res, requestId);

    return send(res, 404, { code: 'NOT_FOUND', message: 'No such publishing-service route.' });
  } catch (e) {
    log.error({ requestId, event: 'unhandled_request_error', message: e instanceof Error ? e.message : 'unknown' });
    if (!res.headersSent) send(res, 500, { success: false, code: 'PUBLISH_FAILED', message: 'An unexpected error occurred. Please try again.' });
  }
});

// Belt-and-braces beyond the per-request try/catch above: if something
// still throws asynchronously outside that scope, log it and keep the
// process alive rather than let Node's default (crash) take down every
// other in-flight publish request too. A single bad request must never be
// able to do that.
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});

server.listen(PORT, () => log.info({ event: 'listening', port: PORT }));

function shutdown(signal) {
  log.info({ event: 'shutdown_start', signal });
  server.close(() => {
    (pool ? pool.end() : Promise.resolve()).finally(() => {
      log.info({ event: 'shutdown_complete' });
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
