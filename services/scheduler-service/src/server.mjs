import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';
import { carouselMediaError } from '../packages/validation/carousel.mjs';
import { createPostStore } from './post-store.mjs';
import { cancelPost, reschedulePost } from './posts.mjs';
import { createWorker } from './worker.mjs';

// scheduler-service — owns scheduled-post execution, due-job discovery,
// atomic claim/locking, bounded retry/backoff, and the draft/scheduled/
// published CRUD API. Does NOT own provider credentials, platform
// publishing logic, OAuth, media storage, or user auth (those are
// integrations-service / publishing-service / media-service / the
// monolith respectively). Faithful port of src/app/api/scheduler/{,check}/
// route.ts + src/lib/post-store.ts + src/lib/posts.ts — see post-store.mjs
// for the one deliberate correctness fix (atomic claim replacing a real
// TOCTOU race in the original).

const PORT = Number(process.env.PORT || 4007);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const PUBLISHING_SERVICE_URL = process.env.PUBLISHING_SERVICE_URL || 'http://publishing-service:4006';
const LEGACY_POSTS_FILE = process.env.LEGACY_POSTS_FILE || '/app/scheduled-posts.json';
const WORKER_ID = `scheduler-${process.env.HOSTNAME || randomUUID().slice(0, 8)}`;
const log = createLogger('scheduler-service');

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
const store = createPostStore(poolProxy, LEGACY_POSTS_FILE);
const worker = createWorker({ store, log, publishingServiceUrl: PUBLISHING_SERVICE_URL, internalSecret: INTERNAL_SECRET, workerId: WORKER_ID });

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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

// --- CRUD routes, faithful port of src/app/api/scheduler/route.ts ---

async function handleList(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  try {
    const posts = await store.listUserPosts(userId);
    return send(res, 200, { posts: posts.map((p) => ({ ...p, accounts: (p.accounts || []).map(({ accessToken: _t, ...a }) => a) })) });
  } catch {
    return send(res, 500, { error: 'Unable to read post storage; no data changed.' });
  }
}

async function handleUpsert(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  try {
    const body = await readJsonBody(req);
    const draft = body.status === 'draft';
    if (typeof body.content !== 'string' || !Array.isArray(body.platforms) || (!draft && (!body.content.trim() || !body.platforms.length))) {
      return send(res, 400, { error: 'Missing content or platforms' });
    }
    if (!draft && (!body.scheduledAt || !Number.isFinite(Date.parse(body.scheduledAt)) || Date.parse(body.scheduledAt) <= Date.now() + 300000)) {
      return send(res, 400, { error: 'Schedule time must be at least 5 minutes from now' });
    }
    // Multiple Images: 1–9 images required when scheduling. Draft saves skip
    // the minimum so an in-progress post can be stored before its first
    // slide exists (the publish-time guard in publishing-service still
    // enforces 1–9 at execution).
    const carouselErr = carouselMediaError(body, { requireMedia: !draft });
    if (carouselErr) return send(res, 400, { error: carouselErr.message });
    const existing = body.id ? await store.getUserPost(userId, body.id) : undefined;
    if (body.id && (!existing || !['draft', 'cancelled', 'pending', 'scheduled'].includes(existing.status))) {
      return send(res, 409, { error: 'Post is missing or no longer editable' });
    }
    const now = new Date().toISOString();
    const base = draft && existing && ['pending', 'scheduled', 'cancelled'].includes(existing.status) ? cancelPost(existing, now) : existing;
    const post = {
      ...base, ...body, id: existing?.id || randomUUID(), imageUrl: body.imageUrl || '',
      accounts: (body.accounts || []).map((a) => ({ platform: a.platform, userId: a.userId, pageId: a.pageId })),
      status: draft ? 'draft' : 'pending', scheduledAt: draft ? null : body.scheduledAt,
      createdAt: existing?.createdAt || now, updatedAt: now, source: base?.source || body.source || 'Manual Draft',
      cancelledAt: base?.cancelledAt || null,
    };
    const saved = await store.upsertUserPost(userId, post);
    return send(res, 200, { success: true, post: saved });
  } catch {
    return send(res, 500, { error: 'Unable to save post; existing storage was not replaced with empty data.' });
  }
}

async function handleReschedule(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  try {
    const { id, scheduledAt } = await readJsonBody(req);
    if (typeof id !== 'string' || !id) return send(res, 400, { error: 'Missing post id' });
    if (typeof scheduledAt !== 'string' || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now() + 300000) {
      return send(res, 400, { error: 'Schedule time must be at least 5 minutes from now' });
    }
    const post = await store.updateUserPost(userId, id, (current) => reschedulePost(current, scheduledAt));
    return send(res, 200, { success: true, post });
  } catch (error) {
    return send(res, 409, { error: error instanceof Error ? error.message : 'Reschedule failed' });
  }
}

async function handleCancelOrDelete(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  try {
    const { id, action } = await readJsonBody(req);
    if (typeof id !== 'string' || !id) return send(res, 400, { error: 'Missing post id' });
    if (action === 'delete-draft') {
      const post = await store.getUserPost(userId, id);
      if (!post || !['draft', 'cancelled'].includes(post.status)) return send(res, 409, { error: 'Only drafts may be deleted' });
      await store.deleteUserPost(userId, id);
      log.info({ event: 'draft_deleted', userId, postId: id });
      return send(res, 200, { success: true });
    }
    const post = await store.updateUserPost(userId, id, (p) => cancelPost(p));
    return send(res, 200, { success: true, post });
  } catch (error) {
    return send(res, 409, { error: error instanceof Error ? error.message : 'Cancellation failed' });
  }
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  try {
    if (req.url === '/health') {
      const workerStatus = worker.status();
      return send(res, 200, {
        service: 'scheduler-service', status: 'ok', timestamp: new Date().toISOString(),
        worker: { running: workerStatus.running, lastLoopAt: workerStatus.lastLoopAt },
      });
    }
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }

    const url = new URL(req.url, 'http://internal');
    if (url.pathname === '/scheduler' && req.method === 'GET') return await handleList(req, res);
    if (url.pathname === '/scheduler' && req.method === 'POST') return await handleUpsert(req, res);
    if (url.pathname === '/scheduler' && req.method === 'PATCH') return await handleReschedule(req, res);
    if (url.pathname === '/scheduler' && req.method === 'DELETE') return await handleCancelOrDelete(req, res);

    // Superadmin / cron "run now" — mirrors src/app/api/scheduler/check,
    // minus the Next-specific internal-actor header (gateway/internal
    // secret already gates this; role check happens at the gateway like
    // every other Superadmin-only route this migration has built).
    if (url.pathname === '/scheduler/check' && req.method === 'POST') {
      const count = await worker.runOnce();
      return send(res, 200, { publishedCount: count, checkedAt: new Date().toISOString() });
    }

    // Phase 12 — Superadmin publishing console, moved out of the
    // monolith's src/lib/publishing-monitor.ts. Cross-user BY DESIGN
    // (store.listAllPosts/adminUpdatePost were already built "Superadmin /
    // worker only" in earlier phases); access control happens upstream
    // (admin-service / gateway), not re-checked here — same trust model
    // every other internal-secret-gated route in this service already uses.
    if (url.pathname === '/internal/posts' && req.method === 'GET') {
      try {
        let posts = await store.listAllPosts();
        const status = url.searchParams.get('status');
        const platform = url.searchParams.get('platform');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 2000);
        if (status === 'scheduled') posts = posts.filter((p) => p.status === 'pending' || p.status === 'scheduled');
        else if (status) posts = posts.filter((p) => p.status === status);
        if (platform) posts = posts.filter((p) => (p.platforms || []).includes(platform));
        // created_at/updated_at come back as raw pg Date objects here (this
        // service has no TIMESTAMPTZ type-parser override) — String(), not
        // .localeCompare on the Date itself.
        posts = posts.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))).slice(0, limit);
        const counts = {
          scheduled: posts.filter((p) => p.status === 'pending' || p.status === 'scheduled').length,
          published: posts.filter((p) => p.status === 'published').length,
          failed: posts.filter((p) => p.status === 'failed').length,
          draft: posts.filter((p) => p.status === 'draft').length,
        };
        return send(res, 200, {
          posts: posts.map((p) => ({
            id: p.id, userId: p.userId, content: p.content, platforms: p.platforms || [],
            failedPlatforms: p.failedPlatforms || null, status: p.status, scheduledAt: p.scheduledAt,
            updatedAt: p.updatedAt || null, createdAt: p.createdAt,
          })),
          counts,
        });
      } catch (e) {
        log.error({ requestId, event: 'internal_posts_list_failed', message: e instanceof Error ? e.message : 'unknown' });
        return send(res, 500, { error: 'Unable to read post storage.' });
      }
    }
    if (url.pathname === '/internal/scrub-post-accounts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const userId = typeof body.userId === 'string' ? body.userId : '';
      const platform = typeof body.platform === 'string' ? body.platform : '';
      const providerUserId = typeof body.providerUserId === 'string' ? body.providerUserId : null;
      if (!userId || !platform) return send(res, 400, { error: 'INVALID_REQUEST' });
      const scrubbedPosts = await store.scrubUserPostAccounts(userId, platform, providerUserId);
      return send(res, 200, { scrubbedPosts });
    }
    if (url.pathname.match(/^\/internal\/posts\/[^/]+\/retry$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      try {
        const post = await store.adminUpdatePost(id, (current) => {
          if (current.status !== 'failed') throw new Error('Only a failed post can be retried.');
          return { ...current, status: 'pending', scheduledAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), failedPlatforms: undefined };
        });
        return send(res, 200, { success: true, post: { id: post.id, status: post.status, scheduledAt: post.scheduledAt } });
      } catch (e) {
        return send(res, 409, { error: e instanceof Error ? e.message : 'Retry failed' });
      }
    }
    if (url.pathname.match(/^\/internal\/posts\/[^/]+\/draft$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      try {
        const post = await store.adminUpdatePost(id, (current) => {
          if (current.status !== 'failed') throw new Error('Only a failed post can be moved to draft.');
          return { ...current, status: 'draft', scheduledAt: null, failedPlatforms: undefined };
        });
        return send(res, 200, { success: true, post: { id: post.id, status: post.status } });
      } catch (e) {
        return send(res, 409, { error: e instanceof Error ? e.message : 'Could not move to draft' });
      }
    }

    return send(res, 404, { code: 'NOT_FOUND', message: 'No such scheduler-service route.' });
  } catch (e) {
    log.error({ requestId, event: 'unhandled_request_error', message: e instanceof Error ? e.message : 'unknown' });
    if (!res.headersSent) send(res, 500, { error: 'An unexpected error occurred. Please try again.' });
  }
});

server.listen(PORT, () => {
  log.info({ event: 'listening', port: PORT });
  worker.start();
  log.info({ event: 'worker_started', workerId: WORKER_ID });
});

function shutdown(signal) {
  log.info({ event: 'shutdown_start', signal });
  worker.stop();
  server.close(() => {
    (pool ? pool.end() : Promise.resolve()).finally(() => {
      log.info({ event: 'shutdown_complete' });
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
