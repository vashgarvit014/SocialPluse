import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';
import { createCanvaRouter } from '../providers/canva/routes.mjs';
import { createLinkedInRouter } from '../providers/linkedin/routes.mjs';
import { createFacebookRouter } from '../providers/facebook/routes.mjs';
import { createInstagramRouter } from '../providers/instagram/routes.mjs';
import { createWhatsAppRouter } from '../providers/whatsapp/routes.mjs';

// integrations-service.
//
// PHASE 3A (unchanged): read-only status/listing for linkedin/facebook/
// instagram/whapi still proxy straight to the monolith's own, already-tested
// routes — not reimplemented, to avoid behavioral drift. See ROUTE_MAP below.
//
// PHASE 3B (new, this round): Canva's OAuth lifecycle + create/edit handoff
// is a REAL re-implementation (providers/canva/*), not a proxy — ported
// faithfully from src/lib/canva.ts / canva-handoffs.ts / oauth-return.ts.
// /api/canva/export is deliberately NOT moved: it calls saveMediaAsset(),
// which belongs to media-service (not extracted yet) — moving it now would
// mean either duplicating media-persistence logic here (wrong owner) or an
// undocumented cross-service call to a service that doesn't exist yet.
// It stays served by the monolith via the generic passthrough until
// media-service exists. See MIGRATION-NOTES.md.
//
// NOTE ON LIVE TRAFFIC: Cloudflare still points only at the monolith
// container (never at the gateway), so none of this — including the ported
// Canva routes — is in the live request path yet. Real users' Canva connect
// flow is completely unaffected by this file. This is a structural
// migration, verified via the gateway's local-only port, not a cutover.

const PORT = Number(process.env.PORT || 4005);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const log = createLogger('integrations-service');
const WHAPI_LOG_FILE = join(process.cwd(), 'whapi-events.log');
const MAX_LOG_BYTES = 32 * 1024 * 1024;

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.error({ event: 'pool_error', message: err.message }));
  return pool;
}
const handleCanvaRoute = createCanvaRouter({ query: (...args) => getPool().query(...args) });
const handleLinkedInRoute = createLinkedInRouter({ query: (...args) => getPool().query(...args) });
const handleFacebookRoute = createFacebookRouter({ query: (...args) => getPool().query(...args) });
const handleInstagramRoute = createInstagramRouter({ query: (...args) => getPool().query(...args) });
// WhatsApp's connections store also needs pool.connect() for one transaction
// (beginQrAttempt) — the other providers only ever call .query().
const handleWhatsAppRoute = createWhatsAppRouter({ query: (...args) => getPool().query(...args), connect: (...args) => getPool().connect(...args) });

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
function whapiLogFull() {
  try { return statSync(WHAPI_LOG_FILE).size >= MAX_LOG_BYTES; } catch { return false; }
}
function sanitizeWebhookPayload(body) {
  try {
    const raw = JSON.stringify(body);
    if (raw.length > 4000) return JSON.parse(`${raw.slice(0, 4000)}...[truncated]`);
    if (typeof body === 'object' && body !== null) {
      const copy = { ...body };
      if (typeof copy.body === 'string' && copy.body.length > 500) copy.body = `${copy.body.slice(0, 200)}...[${copy.body.length} chars]`;
      return copy;
    }
    return body;
  } catch {
    return '[unserializable payload]';
  }
}
async function handleWhapiWebhook(req, res) {
  if (req.method === 'GET') return send(res, 200, { ok: true, webhook: 'whapi', events: ['messages.post', 'statuses.post'] });
  if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const body = await readJsonBody(req);
  if (body === undefined) return send(res, 400, { received: false });
  const eventType = body?.event?.toString?.() || body?.type?.toString?.() || 'unknown';
  const chatId = body?.chat_id?.toString?.() || body?.chatId?.toString?.() || '';
  try {
    const sanitized = sanitizeWebhookPayload(body);
    const line = `${new Date().toISOString()} whapi ${eventType} ${chatId ? `${chatId.slice(0, 12)}...` : ''} ${JSON.stringify(sanitized).slice(0, 800)}\n`;
    try {
      if (!whapiLogFull()) appendFileSync(WHAPI_LOG_FILE, line);
    } catch (err) {
      log.warn({ event: 'whapi_webhook_log_failed', message: err instanceof Error ? err.message : 'unknown' });
    }
    log.info({ event: 'whapi_webhook_received', eventType, chatId: chatId ? `${chatId.slice(0, 12)}...` : undefined });
  } catch {
    log.info({ event: 'whapi_webhook_received' });
  }
  return send(res, 200, { received: true });
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  if (req.url === '/health') {
    return send(res, 200, { service: 'integrations-service', status: 'ok', timestamp: new Date().toISOString() });
  }

  const url = new URL(req.url, 'http://internal');

  if (url.pathname === '/whapi/webhook') {
    return handleWhapiWebhook(req, res);
  }

  // Canva: real routes, internal-secret gated (the gateway is the only
  // caller; actor identity for non-callback routes rides x-actor-user-id).
  if (url.pathname.startsWith('/canva/')) {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    const subpath = url.pathname.replace(/^\/canva/, '');
    const handled = await handleCanvaRoute(subpath, req, res, { requestId, isHttps: process.env.NODE_ENV === 'production' });
    if (handled !== null) return;
    return send(res, 404, { code: 'NOT_FOUND', message: 'No such Canva route.' });
  }

  // LinkedIn: real routes (Phase 3B, this round), same shape as Canva.
  if (url.pathname.startsWith('/linkedin/')) {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    const subpath = url.pathname.replace(/^\/linkedin/, '');
    const handled = await handleLinkedInRoute(subpath, req, res, { requestId, isHttps: process.env.NODE_ENV === 'production' });
    if (handled !== null) return;
    return send(res, 404, { code: 'NOT_FOUND', message: 'No such LinkedIn route.' });
  }

  // Facebook: real routes (Phase 3B, this round), same shape as LinkedIn.
  if (url.pathname.startsWith('/facebook/')) {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    const subpath = url.pathname.replace(/^\/facebook/, '');
    const handled = await handleFacebookRoute(subpath, req, res, { requestId, isHttps: process.env.NODE_ENV === 'production' });
    if (handled !== null) return;
    return send(res, 404, { code: 'NOT_FOUND', message: 'No such Facebook route.' });
  }

  // Instagram: real routes (Phase 3B, this round) — status/disconnect only.
  // No auth/callback here: Instagram has no independent OAuth (see
  // providers/instagram/routes.mjs header comment) — those stay on the
  // monolith's existing thin-redirect/dead-route behavior, untouched.
  if (url.pathname.startsWith('/instagram/')) {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    const subpath = url.pathname.replace(/^\/instagram/, '');
    const handled = await handleInstagramRoute(subpath, req, res);
    if (handled !== null) return;
    return send(res, 404, { code: 'NOT_FOUND', message: 'No such Instagram route.' });
  }

  // WhatsApp/Whapi provider routes.
  if (url.pathname.startsWith('/whatsapp/')) {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    const subpath = url.pathname.replace(/^\/whatsapp/, '');
    const handled = await handleWhatsAppRoute(subpath, req, res);
    if (handled !== null) return;
    return send(res, 404, { code: 'NOT_FOUND', message: 'No such WhatsApp route.' });
  }

  if (url.pathname === '/status/whapi' || url.pathname.startsWith('/whapi/')) {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    const handled = await handleWhatsAppRoute(url.pathname, req, res);
    if (handled !== null) return;
    return send(res, 404, { code: 'NOT_FOUND', message: 'No such Whapi route.' });
  }

  return send(res, 404, { code: 'NOT_FOUND', message: 'No such integrations-service route.' });
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
// Safety net found necessary by a real crash during testing elsewhere in
// this migration (publishing-service): an uncaught async error anywhere
// in a request handler is a Node process-level unhandledRejection by
// default, which CRASHES the whole service — taking down every other
// in-flight request too, not just the one that errored. Log and survive.
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
