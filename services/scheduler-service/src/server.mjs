import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';
import { carouselMediaError } from '../packages/validation/carousel.mjs';
import { createPostStore } from './post-store.mjs';
import { createPlatformStore } from './platform-store.mjs';
import { createConnectionChecker } from './connections.mjs';
import { createNotifier } from './notifications.mjs';
import { resolveOverallStatus, summarizePlatforms, POST_STATUS } from './status.mjs';
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
// Distinguishes a user-triggered retry lock from the background worker's, so
// the two can never be mistaken for each other in scheduled_posts.locked_by.
const RETRY_ACTOR = `${WORKER_ID}-retry`;
// Flipped to false only if scheduled_post_platforms cannot be created, in
// which case the worker stays stopped and /health reports DOWN rather than
// claiming a healthy scheduler it cannot actually run.
let schemaReady = false;
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
// Lazily-built query surface shared by every store. `transaction(fn)` checks
// out ONE client and hands it to fn, so a multi-table write (the post row AND
// its per-platform rows) commits or rolls back as a unit. Without that, a
// crash between the two writes would leave a SCHEDULED post whose target
// platforms the worker never sees — silently unpublishable.
const poolProxy = {
  query: (...args) => getPool().query(...args),
  async transaction(fn) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn({ query: (...args) => client.query(...args) });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      throw e;
    } finally {
      client.release();
    }
  },
};
const store = createPostStore(poolProxy, LEGACY_POSTS_FILE);
// The per-platform store, connection preflight and notifier share the same
// lazy pool proxy so nothing opens a DB connection at import time.
const platformStore = createPlatformStore(poolProxy);
const connections = createConnectionChecker(poolProxy);
const notifier = createNotifier(poolProxy, log);
const worker = createWorker({
  store, platformStore, connections, notifier, log,
  publishingServiceUrl: PUBLISHING_SERVICE_URL, internalSecret: INTERNAL_SECRET, workerId: WORKER_ID,
});

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
    // One batched read for the whole page — not a query per post.
    const platformRows = await platformStore.listForPosts(posts.map((p) => p.id));
    const byPost = new Map();
    for (const row of platformRows) {
      if (!byPost.has(row.scheduledPostId)) byPost.set(row.scheduledPostId, []);
      byPost.get(row.scheduledPostId).push(row);
    }
    return send(res, 200, {
      posts: posts.map((p) => {
        const platforms = (byPost.get(p.id) || []).map(stripConnectionFields);
        return {
          ...p,
          accounts: (p.accounts || []).map(({ accessToken: _t, ...a }) => a),
          platformStatuses: platforms,
          // Derived, never stored — so it can never disagree with the rows.
          overallStatus: resolveOverallStatus(platforms, { postStatus: p.status }),
          summary: summarizePlatforms(platforms),
        };
      }),
    });
  } catch {
    return send(res, 500, { error: 'Unable to read post storage; no data changed.' });
  }
}

// Platform rows carry a connection id (a UUID foreign key), never a token.
function stripConnectionFields(row) {
  const { ...rest } = row;
  return rest;
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
    const targets = (post.accounts || []).map((a) => ({ platform: a.platform, destination: a.pageId || a.userId || null }));

    // ONE transaction for the post row AND its per-platform rows. A schedule
    // is only accepted once the target platforms are durably recorded; a
    // partial write would leave a SCHEDULED post the worker could never publish
    // to, which is worse than a clean failure the user can retry.
    const saved = await poolProxy.transaction(async (tx) => {
      const record = await store.upsertUserPost(userId, post, tx);
      if (!draft) await platformStore.syncForPost(record.id, userId, targets, tx);
      else await platformStore.cancelAllForPost(userId, record.id);
      return record;
    });

    if (!draft) {
      log.info({
        event: 'SCHEDULED_POST_CREATED', userId, scheduledPostId: saved.id,
        platforms: [...new Set(targets.map((t) => t.platform))].join(','),
        scheduledAt: saved.scheduledAt, timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      });
    }
    return send(res, 200, { success: true, post: saved });
  } catch (e) {
    log.error({ event: 'schedule_upsert_failed', message: e instanceof Error ? e.message : 'unknown' });
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
    // Same rule as an initial schedule: the parent row and the per-platform
    // rows move together, so a reschedule can never leave the parent pending
    // while its platform rows are CANCELLED.
    const post = await poolProxy.transaction(async (tx) => {
      const updated = await store.updateUserPost(userId, id, (current) => reschedulePost(current, scheduledAt));
      const targets = (updated.accounts || []).map((a) => ({ platform: a.platform, destination: a.pageId || a.userId || null }));
      await platformStore.syncForPost(id, userId, targets, tx);
      return updated;
    });
    log.info({ event: 'SCHEDULED_POST_RESCHEDULED', userId, scheduledPostId: id, scheduledAt });
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
      log.info({ event: 'draft_deleted', userId, scheduledPostId: id });
      return send(res, 200, { success: true });
    }
    // Cancelling transitions the platform rows in the same transaction. They
    // are the worker's actual to-do list, so leaving them PENDING would be the
    // one way a cancelled record could still publish.
    const post = await poolProxy.transaction(async (tx) => {
      const updated = await store.updateUserPost(userId, id, (p) => cancelPost(p));
      await platformStore.cancelAllForPost(userId, id, tx);
      return updated;
    });
    log.info({ event: 'SCHEDULED_POST_CANCELLED', userId, scheduledPostId: id });
    return send(res, 200, { success: true, post });
  } catch (error) {
    return send(res, 409, { error: error instanceof Error ? error.message : 'Cancellation failed' });
  }
}

// --- "Retry failed" — user-scoped, and it re-runs ONLY the platforms that
// did not publish. PUBLISHED rows are excluded by construction inside
// platformStore.listRetryable + claimPlatform, so a retry can never
// republish LinkedIn/Facebook/WhatsApp just because Instagram was missing.
async function handleRetryFailed(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  try {
    const body = await readJsonBody(req);
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return send(res, 400, { error: 'Missing post id' });

    const post = await store.getUserPost(userId, id);
    if (!post) return send(res, 404, { error: 'Post not found' });

    const retryable = await platformStore.listRetryable(id, userId, Array.isArray(body.platforms) ? body.platforms : undefined);
    if (!retryable.length) return send(res, 409, { error: 'There is no failed platform to retry on this post.' });

    // Re-arm the rows, the parent and the actual publish all in ONE transaction,
    // then claim ONLY this post. worker.runOnce() must not be used here: it
    // claims every due post, so clicking "Retry failed" on one post would
    // publish unrelated scheduled posts as a side effect.
    const claimed = await poolProxy.transaction(async (tx) => {
      for (const row of retryable) await platformStore.armRowForRetry(userId, id, row.platform, tx);
      await store.armForRetry(userId, id);
      return store.claimPostById(userId, id, `retry-${RETRY_ACTOR}`, { now: new Date() });
    });

    const alreadyPublished = (await platformStore.listForPost(id, userId)).filter((r) => r.status === 'PUBLISHED').map((r) => r.platform);
    log.info({
      event: 'SCHEDULE_RETRY_STARTED', userId, scheduledPostId: id,
      platforms: retryable.map((r) => r.platform).join(','),
      alreadyPublished: alreadyPublished.join(',') || 'none',
    });

    // Run immediately so the user's click has a visible result. Still entirely
    // server-side — the browser only requested it.
    if (claimed) await worker.publishClaimed(claimed);
    else log.warn({ event: 'SCHEDULE_RETRY_SKIPPED', userId, scheduledPostId: id, reason: 'already_claimed_or_not_due' });

    const after = await platformStore.listForPost(id, userId);
    const publishedNow = retryable.filter((r) => after.find((a) => a.platform === r.platform)?.status === 'PUBLISHED');
    const summary = summarizePlatforms(after);
    if (publishedNow.length) {
      log.info({ event: 'SCHEDULE_RETRY_SUCCESS', userId, scheduledPostId: id, platforms: publishedNow.map((r) => r.platform).join(',') });
      await notifier.notify({
        userId, type: 'SCHEDULE_RETRY_SUCCESS',
        title: 'Retry succeeded',
        message: `${publishedNow.map((r) => labelFor(r.platform)).join(', ')} published. ${summary.headline}`.trim(),
        metadata: { scheduledPostId: id, retried: publishedNow.map((r) => r.platform), published: summary.published, total: summary.total },
      });
    } else {
      log.warn({ event: 'SCHEDULE_RETRY_FAILED', userId, scheduledPostId: id });
    }

    return send(res, 200, {
      success: true,
      retried: retryable.map((r) => r.platform),
      platformStatuses: after,
      overallStatus: resolveOverallStatus(after, { postStatus: undefined }),
      summary,
    });
  } catch (e) {
    return send(res, 409, { error: e instanceof Error ? e.message : 'Retry failed' });
  }
}

// Pre-disconnect confirmation: "Instagram has 4 scheduled posts."
// Reads only this user's future scheduled posts for the platform in question.
async function handleConnectivityWarning(req, res, url) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  const platform = url.searchParams.get('platform');
  if (!platform) return send(res, 400, { error: 'Missing platform' });
  try {
    const posts = await store.listUserPosts(userId);
    const now = Date.now();
    const affected = [];
    for (const p of posts) {
      if (!['pending', 'scheduled'].includes(p.status)) continue;
      if (p.scheduledAt && Date.parse(p.scheduledAt) <= now) continue; // already due/being handled
      const rows = await platformStore.listForPost(p.id, userId);
      const row = rows.find((r) => r.platform === platform);
      if (!row) continue;
      if (row.status === 'PUBLISHED') continue;
      affected.push({ id: p.id, scheduledAt: p.scheduledAt, status: row.status });
    }
    return send(res, 200, { platform, count: affected.length, posts: affected });
  } catch {
    return send(res, 500, { error: 'Unable to check scheduled posts.' });
  }
}

function labelFor(p) {
  return p === 'linkedin' ? 'LinkedIn' : p === 'whatsapp' ? 'WhatsApp' : p === 'facebook' ? 'Facebook' : p === 'instagram' ? 'Instagram' : p;
}

// User notifications (admin_notifications rows with this user's user_id).
async function handleNotifications(req, res, url) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  const { rows } = await poolProxy.query(
    `SELECT id, type, category, severity, title, message, metadata, is_read, created_at, read_at
       FROM admin_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  const unread = await poolProxy.query(
    `SELECT COUNT(*)::int AS n FROM admin_notifications WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return send(res, 200, {
    notifications: rows.map((r) => ({
      id: r.id, type: r.type, category: r.category, severity: r.severity,
      title: r.title, message: r.message, metadata: r.metadata || {},
      isRead: r.is_read, createdAt: r.created_at, readAt: r.read_at,
    })),
    unread: unread.rows[0]?.n || 0,
  });
}

async function handleNotificationsRead(req, res) {
  const userId = requireActor(req);
  if (!userId) return send(res, 401, { error: 'Unauthorized' });
  const body = await readJsonBody(req);
  const ids = Array.isArray(body.ids) && body.ids.length ? body.ids : null;
  if (ids) {
    await poolProxy.query(
      `UPDATE admin_notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND id = ANY($2)`,
      [userId, ids],
    );
  } else {
    await poolProxy.query(`UPDATE admin_notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND is_read = false`, [userId]);
  }
  return send(res, 200, { success: true });
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
      // Real metrics, not a canned string — the gateway's System Health
      // aggregates this payload directly.
      const metrics = await store.getSchedulerHealth();
      const state = !schemaReady ? 'DOWN'
        : !workerStatus.running ? 'DOWN'
          : (metrics.dueJobs > 0 || metrics.processingJobs > 0 || metrics.failedLast24h > 0) ? 'DEGRADED' : 'HEALTHY';
      return send(res, 200, {
        service: 'scheduler-service', status: 'ok', timestamp: new Date().toISOString(),
        scheduler: {
          state,
          worker: { running: workerStatus.running, lastLoopAt: workerStatus.lastLoopAt, lastTick: workerStatus.stats },
          metrics,
        },
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
    if (url.pathname === '/scheduler/retry' && req.method === 'POST') return await handleRetryFailed(req, res);
    if (url.pathname === '/scheduler/connectivity-warning' && req.method === 'GET') return await handleConnectivityWarning(req, res, url);
    if (url.pathname === '/scheduler/notifications' && req.method === 'GET') return await handleNotifications(req, res, url);
    if (url.pathname === '/scheduler/notifications/read' && req.method === 'POST') return await handleNotificationsRead(req, res);

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
    // A platform was disconnected or reconnected by integrations-service.
    // Disconnect: mark every FUTURE scheduled row for that user+platform
    // CONNECTION_REQUIRED right away, so the warning is visible in the
    // Scheduler before the due time — not only after the worker discovers it.
    // Reconnect: put those rows back in the queue and tell the user.
    if (url.pathname === '/internal/platform-connectivity' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const userId = typeof body.userId === 'string' ? body.userId : '';
      const platform = typeof body.platform === 'string' ? body.platform : '';
      if (!userId || !platform) return send(res, 400, { error: 'INVALID_REQUEST' });
      const label = platform === 'linkedin' ? 'LinkedIn' : platform === 'whatsapp' ? 'WhatsApp' : platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : platform;

      if (body.action === 'reconnect') {
        const affected = await platformStore.releaseConnectionRequired(userId, platform);
        await notifier.notify({
          userId, type: 'PLATFORM_RECONNECTED',
          title: `${label} reconnected`,
          message: `${label} reconnected. Your failed scheduled post${affected === 1 ? ' is' : 's are'} ready to retry.`,
          metadata: { platform, rowsReleased: affected },
        });
        return send(res, 200, { affected });
      }

      const message = `${label} is disconnected, so scheduled ${label} posts cannot publish until the account is reconnected.`;
      const affected = await platformStore.markFutureConnectionRequired(userId, platform, message);
      // The parent post's stored status is intentionally left alone: the
      // scheduler list derives overallStatus from these per-platform rows on
      // every read, so the warning appears immediately without a write to
      // scheduled_posts (which the worker owns).
      log.info({ event: 'PLATFORM_DISCONNECTED', userId, platform, affected });
      return send(res, 200, { affected });
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

server.listen(PORT, async () => {
  log.info({ event: 'listening', port: PORT });
  // The per-platform table must exist before the first claim, and this
  // service may boot before the web app (whose db.ts also carries this DDL).
  //
  // If it cannot be created the worker must NOT start: it would claim posts
  // and then fail per-platform writes, marking real scheduled posts failed
  // for a reason that has nothing to do with the user. Report unhealthy and
  // retry the schema check instead — the API stays up so /health is honest.
  try {
    await platformStore.ensureSchema();
    log.info({ event: 'schema_ready', table: 'scheduled_post_platforms' });
    worker.start();
    log.info({ event: 'worker_started', workerId: WORKER_ID });
  } catch (e) {
    schemaReady = false;
    log.error({ event: 'schema_init_failed', message: e instanceof Error ? e.message : 'unknown' });
    setTimeout(async () => {
      try {
        await platformStore.ensureSchema();
        schemaReady = true;
        log.info({ event: 'schema_ready', table: 'scheduled_post_platforms', recovered: true });
        worker.start();
        log.info({ event: 'worker_started', workerId: WORKER_ID, recovered: true });
      } catch (retryErr) {
        log.error({ event: 'schema_init_retry_failed', message: retryErr instanceof Error ? retryErr.message : 'unknown' });
      }
    }, 10_000).unref();
  }
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
