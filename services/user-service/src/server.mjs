import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool, types } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';
import { createUserStore } from './users.mjs';
import { createModerationStore } from './moderation.mjs';

// user-service — owns profile data, account state, and user-level
// moderation metadata (moderation_violation_count/flagged/flagReason/
// flaggedAt on `users`, plus `moderation_events`). Does NOT own
// authentication identity, sessions, passwords, OTP, or role assignment —
// that stays in the monolith until auth-service exists (next, last phase).
//
// Faithful port of the read/account-state parts of src/lib/auth/users.ts
// and all of src/lib/moderation-escalation.ts. Every route here is
// internal-secret-gated only — callers are the gateway (for the one
// browser-facing path, /me) and admin-service/ai-service (service-to-
// service). No internal route is reachable from the browser directly.

const PORT = Number(process.env.PORT || 4010);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const log = createLogger('user-service');

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.error({ event: 'pool_error', message: err.message }));
  return pool;
}
const poolProxy = { query: (...a) => getPool().query(...a), connect: (...a) => getPool().connect(...a) };
const userStore = createUserStore(poolProxy);
const moderationStore = createModerationStore(poolProxy);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  try {
    if (req.url === '/health') {
      // No DB probe on the hot path by design (matches ai-service's
      // health route) — but this service IS nothing without the DB, so a
      // lightweight reachability check is worth the one extra round trip:
      // profile/account-state reads are this service's entire purpose.
      try {
        await getPool().query('SELECT 1');
        return send(res, 200, { service: 'user-service', status: 'ok', timestamp: new Date().toISOString() });
      } catch {
        return send(res, 503, { service: 'user-service', status: 'degraded', timestamp: new Date().toISOString() });
      }
    }

    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }

    const url = new URL(req.url, 'http://internal');
    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['internal','users','<id>','status']

    // GET /me — the one path reachable (via the gateway) from a signed-in
    // browser session, used for the header/profile-menu DTO (same fields
    // as the monolith's /api/auth/me route, never passwordHash/otp/
    // session-token/OAuth-token fields — toUser() in users.mjs never
    // carries those to begin with).
    if (url.pathname === '/me' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      const user = await userStore.findUserById(userId);
      if (!user) return send(res, 404, { error: 'User not found.' });
      return send(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
    }

    // GET /internal/users?search=&status=&limit=&offset= — list, for
    // admin-service's Superadmin user table.
    if (url.pathname === '/internal/users' && req.method === 'GET') {
      const search = url.searchParams.get('search') || undefined;
      const statusParam = url.searchParams.get('status');
      const status = ['ACTIVE', 'PENDING', 'SUSPENDED'].includes(statusParam) ? statusParam : undefined;
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
      const { users, total } = await userStore.listUsers({ search, status, limit, offset });
      return send(res, 200, { users, total, limit, offset });
    }

    if (url.pathname === '/internal/users/counts' && req.method === 'GET') {
      const counts = await userStore.countUsersByStatus();
      return send(res, 200, { counts });
    }

    // GET /internal/moderation/queue — Phase 11: faithful port of the SQL
    // from src/app/superadmin/moderation/page.tsx, which previously ran
    // this query directly against Postgres from inside the monolith's SSR
    // render. Same query, same ordering, same LIMIT 200.
    if (url.pathname === '/internal/moderation/queue' && req.method === 'GET') {
      const rows = await poolProxy.query(`
        SELECT u.id, u.name, u.email, u.status, u.created_at, u.last_login_at,
               u.moderation_violation_count, u.moderation_flagged, u.moderation_flag_reason,
               u.moderation_flagged_at, u.moderation_first_violation_at, u.moderation_last_violation_at,
               (SELECT e.decision FROM moderation_events e WHERE e.user_id = u.id ORDER BY e.created_at DESC LIMIT 1) AS latest_decision,
               (SELECT e.method  FROM moderation_events e WHERE e.user_id = u.id ORDER BY e.created_at DESC LIMIT 1) AS latest_method
          FROM users u
         WHERE u.moderation_violation_count > 0 OR u.moderation_flagged
            OR EXISTS (SELECT 1 FROM moderation_events e WHERE e.user_id = u.id)
         ORDER BY u.moderation_violation_count DESC, u.moderation_last_violation_at DESC NULLS LAST
         LIMIT 200
      `);
      const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      const todayRows = await poolProxy.query(
        `SELECT count(*) AS count FROM moderation_events WHERE created_at >= $1 AND decision <> 'ALLOW'`,
        [todayStart],
      );
      return send(res, 200, { users: rows.rows, warningsToday: Number(todayRows.rows[0]?.count || 0) });
    }

    // GET /internal/users/:id — single profile, for admin-service's user
    // detail page and the moderation summary's user header.
    if (parts[0] === 'internal' && parts[1] === 'users' && parts.length === 3 && req.method === 'GET') {
      const id = parts[2];
      if (!UUID_RE.test(id)) return send(res, 404, { error: 'User not found.' });
      const user = await userStore.findUserById(id);
      if (!user) return send(res, 404, { error: 'User not found.' });
      return send(res, 200, { user });
    }

    // PATCH /internal/users/:id/status — Superadmin suspend/reactivate
    // (the simple status toggle; no session_version bump — see users.mjs).
    if (parts[0] === 'internal' && parts[1] === 'users' && parts[3] === 'status' && parts.length === 4 && req.method === 'PATCH') {
      const id = parts[2];
      if (!UUID_RE.test(id)) return send(res, 404, { error: 'User not found.' });
      const body = await readJsonBody(req);
      if (body.status !== 'ACTIVE' && body.status !== 'SUSPENDED') return send(res, 400, { error: 'Invalid status.' });
      const result = await userStore.setUserStatus(id, body.status);
      if (!result.ok) return send(res, 400, { error: result.error });
      return send(res, 200, { success: true, status: body.status });
    }

    // GET /internal/users/:id/moderation — summary for the Superadmin
    // moderation panel.
    if (parts[0] === 'internal' && parts[1] === 'users' && parts[3] === 'moderation' && parts.length === 4 && req.method === 'GET') {
      const id = parts[2];
      if (!UUID_RE.test(id)) return send(res, 404, { error: 'User not found.' });
      const user = await userStore.findUserById(id);
      if (!user) return send(res, 404, { error: 'User not found.' });
      const summary = await moderationStore.getUserModerationSummary(id);
      const { severityForCount } = await import('./moderation.mjs');
      return send(res, 200, { moderation: { ...summary, severity: severityForCount(summary.violationCount) } });
    }

    // POST /internal/users/:id/moderation — Superadmin action: clear-flag |
    // reset-counter | suspend | reactivate.
    if (parts[0] === 'internal' && parts[1] === 'users' && parts[3] === 'moderation' && parts.length === 4 && req.method === 'POST') {
      const id = parts[2];
      if (!UUID_RE.test(id)) return send(res, 404, { error: 'User not found.' });
      const user = await userStore.findUserById(id);
      if (!user) return send(res, 404, { error: 'User not found.' });
      const body = await readJsonBody(req);
      const result = await moderationStore.applyModerationAction(id, body.action);
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 200, result);
    }

    // POST /internal/users/:id/moderation/decision — ai-service's
    // post-moderation-decision escalation call. One atomic transaction;
    // see moderation.mjs for why the admin_notifications insert stays
    // inside it rather than becoming a second network call.
    if (parts[0] === 'internal' && parts[1] === 'users' && parts[3] === 'moderation' && parts[4] === 'decision' && parts.length === 5 && req.method === 'POST') {
      const id = parts[2];
      if (!UUID_RE.test(id)) return send(res, 404, { error: 'User not found.' });
      const body = await readJsonBody(req);
      const outcome = await moderationStore.recordModerationDecision(
        { decision: body.decision, method: body.method, countsAsViolation: body.countsAsViolation },
        { userId: id, action: body.action, provider: body.provider ?? null, reason: body.reason, promptFingerprint: body.promptFingerprint ?? null, safeMetadata: body.safeMetadata },
      );
      return send(res, 200, outcome);
    }

    return send(res, 404, { code: 'NOT_FOUND', message: 'No such user-service route.' });
  } catch (err) {
    log.error({ requestId, event: 'request_failed', message: err instanceof Error ? err.message : 'unknown' });
    if (!res.headersSent) return send(res, 500, { code: 'USER_SERVICE_ERROR', message: 'Internal error.' });
  }
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
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
