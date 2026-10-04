import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool, types } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret, internalFetchHeaders } from '../packages/service-auth/index.mjs';
import {
  listAuthEvents, listAuthEventsFiltered, listDistinctAuthEvents,
  listActiveSessions, countActiveSessions, getSystemHealth,
  listSystemLogs, getOpsSummary, listNotifications, unreadNotificationCount,
  markNotificationRead, markAllNotificationsRead,
} from './reporting.mjs';

// admin-service — Superadmin audit-log viewing (read-only, `auth_audit_logs`,
// owned directly) PLUS, as of this round, Superadmin user-management actions
// (list/detail/suspend/reactivate/moderation flag-clear) — these do NOT own
// the data themselves; they proxy to user-service's internal API, which owns
// the `users`/`moderation_events` writes. admin-service's own job for those
// routes is just: enforce the action happened (gateway already verified
// SUPERADMIN before the request got here), and write the matching
// auth_audit_logs row for suspend/reactivate (parity with the original
// monolith route, which logged via lib/auth/audit.ts#logAuthEvent).
//
// Other admin ACTIONS (create-user/terminate-session/retry-publish) stay in
// the monolith for now — not in this round's scope, see MIGRATION-NOTES.md.

const PORT = Number(process.env.PORT || 4009);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:4010';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:4011';
const SCHEDULER_SERVICE_URL = process.env.SCHEDULER_SERVICE_URL || 'http://scheduler-service:4007';
const log = createLogger('admin-service');

async function callService(baseUrl, path, { method = 'GET', body } = {}) {
  const requestId = randomUUID();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: internalFetchHeaders(INTERNAL_SECRET, requestId, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const callUserService = (path, opts) => callService(USER_SERVICE_URL, path, opts);
const callAuthService = (path, opts) => callService(AUTH_SERVICE_URL, path, opts);
const callSchedulerService = (path, opts) => callService(SCHEDULER_SERVICE_URL, path, opts);

// Same event list/shape as src/lib/auth/audit.ts#logAuthEvent — fire-and-
// forget, a lost audit line must never fail or delay the actual action.
function logAuditEvent(db, event, { userId, meta }) {
  db.query(
    `INSERT INTO auth_audit_logs (id, event, user_id, channel, purpose, ip, created_at, meta) VALUES ($1,$2,$3,NULL,NULL,NULL,$4,$5)`,
    [randomUUID(), event, userId || null, new Date().toISOString(), meta ? JSON.stringify(meta) : null],
  ).catch((err) => log.warn({ event: 'audit_log_write_failed', message: err instanceof Error ? err.message : 'unknown' }));
}

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

// Same event list / query shape as src/lib/auth/audit.ts#listAdminAuditEvents
// — kept identical on purpose; this is a straight read-path extraction, not
// a redesign.
const ADMIN_ACTION_EVENTS = [
  'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED', 'USER_CREATED_BY_ADMIN', 'RESET_ACCESS_TRIGGERED',
  'SESSION_TERMINATED', 'PUBLISH_RETRIED', 'PUBLISH_MOVED_TO_DRAFT',
];

async function listAdminAuditEvents({ search, limit }) {
  const db = getPool();
  const clauses = ['a.event = ANY($1)'];
  const params = [ADMIN_ACTION_EVENTS];
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT a.id, a.event, a.created_at, a.meta, u.name AS user_name, u.email AS user_email
     FROM auth_audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id, event: r.event, targetUserName: r.user_name, targetUserEmail: r.user_email,
    createdAt: r.created_at, meta: r.meta,
  }));
}

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

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  if (req.url === '/health') {
    return send(res, 200, { service: 'admin-service', status: 'ok', timestamp: new Date().toISOString() });
  }

  const url = new URL(req.url, 'http://internal');
  if (url.pathname === '/audit-logs' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    try {
      const search = url.searchParams.get('search') || undefined;
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 300);
      const events = await listAdminAuditEvents({ search, limit });
      return send(res, 200, { events });
    } catch (err) {
      log.error({ requestId, event: 'audit_logs_query_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const actorUserId = req.headers['x-actor-user-id'];

  // GET /users/counts — Phase 11: Superadmin shell's status-tab counts
  // (was countUsersByStatus() called directly from the layout's SSR render).
  if (url.pathname === '/users/counts' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const { status, data } = await callUserService('/internal/users/counts');
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'users_counts_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /moderation/queue — Phase 11: the Superadmin moderation overview
  // page's cross-user query (was run directly against Postgres from the
  // monolith's SSR render).
  if (url.pathname === '/moderation/queue' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const { status, data } = await callUserService('/internal/moderation/queue');
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'moderation_queue_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /users/:id/auth-events?limit= — Phase 11: the user detail page's
  // "Recent auth activity" panel (was listAuthEventsForUser() called
  // directly from the monolith's SSR render). Same table admin-service's
  // own /audit-logs already reads directly (Phase 1 precedent) — reads
  // for cross-cutting reporting stay here, writes stay in auth-service.
  if (parts[0] === 'users' && parts[2] === 'auth-events' && parts.length === 3 && req.method === 'GET') {
    try {
      if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 8, 1), 100);
      const { rows } = await getPool().query(
        'SELECT * FROM auth_audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [parts[1], limit],
      );
      const events = rows.map((r) => ({ id: r.id, event: r.event, channel: r.channel, purpose: r.purpose, ip: r.ip, createdAt: r.created_at, meta: r.meta }));
      return send(res, 200, { events });
    } catch (err) {
      log.error({ requestId, event: 'user_auth_events_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /users?search=&status=&limit=&offset= — Superadmin user table.
  if (url.pathname === '/users' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const { status, data } = await callUserService(`/internal/users${url.search}`);
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'users_list_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /users/:id — Superadmin user detail.
  if (parts[0] === 'users' && parts.length === 2 && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const { status, data } = await callUserService(`/internal/users/${parts[1]}`);
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'user_detail_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // PATCH /users/:id/status — suspend/reactivate (the simple status toggle).
  if (parts[0] === 'users' && parts[2] === 'status' && parts.length === 3 && req.method === 'PATCH') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const body = await readJsonBody(req);
      const { status, data } = await callUserService(`/internal/users/${parts[1]}/status`, { method: 'PATCH', body });
      if (status === 200) {
        logAuditEvent(getPool(), body.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED', { userId: parts[1], meta: { actorUserId } });
      }
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'user_status_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /moderation/users/:id — moderation summary (combines user-service's
  // profile + moderation-summary reads, same response shape as the original
  // monolith route).
  if (parts[0] === 'moderation' && parts[1] === 'users' && parts.length === 3 && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const id = parts[2];
      const userRes = await callUserService(`/internal/users/${id}`);
      if (userRes.status !== 200) return send(res, userRes.status, userRes.data);
      const modRes = await callUserService(`/internal/users/${id}/moderation`);
      if (modRes.status !== 200) return send(res, modRes.status, modRes.data);
      const u = userRes.data.user;
      return send(res, 200, {
        user: { id: u.id, name: u.name, email: u.email, status: u.status, created_at: u.createdAt, last_login_at: u.lastLoginAt },
        moderation: modRes.data.moderation,
      });
    } catch (err) {
      log.error({ requestId, event: 'moderation_summary_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // POST /moderation/users/:id — clear-flag | reset-counter | suspend | reactivate.
  if (parts[0] === 'moderation' && parts[1] === 'users' && parts.length === 3 && req.method === 'POST') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const id = parts[2];
      const body = await readJsonBody(req);
      const { status, data } = await callUserService(`/internal/users/${id}/moderation`, { method: 'POST', body });
      if (status === 200 && (body.action === 'suspend' || body.action === 'reactivate')) {
        logAuditEvent(getPool(), body.action === 'suspend' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED', { userId: id, meta: { actorUserId, via: 'moderation' } });
      }
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'moderation_action_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // ============================================================
  // Phase 12 — Superadmin dashboard/operational reporting, moved out of
  // the monolith's SSR layout/pages. All gated the same way every other
  // route in this file already is (internal secret; SUPERADMIN role was
  // already verified by the gateway before the request got here).
  // ============================================================

  // GET /system-health
  if (url.pathname === '/system-health' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      return send(res, 200, { checks: await getSystemHealth(getPool()) });
    } catch (err) {
      log.error({ requestId, event: 'system_health_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /logs?category=&level=&platform=&q=&from=&to=&limit=&offset=
  if (url.pathname === '/logs' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const sp = url.searchParams;
      const result = await listSystemLogs(getPool(), {
        category: sp.get('category') || undefined, level: sp.get('level') || undefined, platform: sp.get('platform') || undefined,
        q: sp.get('q') || undefined, from: sp.get('from') || undefined, to: sp.get('to') || undefined,
        limit: Number(sp.get('limit')) || undefined, offset: Number(sp.get('offset')) || undefined,
      });
      return send(res, 200, result);
    } catch (err) {
      log.error({ requestId, event: 'logs_query_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /auth-events?limit=
  if (url.pathname === '/auth-events' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 6, 1), 100);
      return send(res, 200, { events: await listAuthEvents(getPool(), limit) });
    } catch (err) {
      log.error({ requestId, event: 'auth_events_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /auth-events/filtered?search=&event=&channel=&limit=
  if (url.pathname === '/auth-events/filtered' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const sp = url.searchParams;
      const limit = Math.min(Math.max(Number(sp.get('limit')) || 150, 1), 500);
      const events = await listAuthEventsFiltered(getPool(), { search: sp.get('search') || undefined, event: sp.get('event') || undefined, channel: sp.get('channel') || undefined, limit });
      return send(res, 200, { events });
    } catch (err) {
      log.error({ requestId, event: 'auth_events_filtered_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /auth-events/distinct
  if (url.pathname === '/auth-events/distinct' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      return send(res, 200, { events: await listDistinctAuthEvents(getPool()) });
    } catch (err) {
      log.error({ requestId, event: 'auth_events_distinct_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /sessions?limit= — active session list.
  if (url.pathname === '/sessions' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 300);
      const [sessions, total] = await Promise.all([listActiveSessions(getPool(), limit), countActiveSessions(getPool())]);
      return send(res, 200, { sessions, total });
    } catch (err) {
      log.error({ requestId, event: 'sessions_list_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // DELETE /sessions/:id — terminate. Revoke itself happens in
  // auth-service (the table's owner); logs the same SESSION_TERMINATED
  // audit event the original monolith route wrote.
  if (parts[0] === 'sessions' && parts.length === 2 && req.method === 'DELETE') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const { status, data } = await callAuthService(`/internal/sessions/${parts[1]}/revoke`, { method: 'POST' });
      if (status === 200) logAuditEvent(getPool(), 'SESSION_TERMINATED', { meta: { terminatedBy: actorUserId, sessionId: parts[1] } });
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'session_revoke_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /notifications?unread=1
  if (url.pathname === '/notifications' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const unreadOnly = url.searchParams.get('unread') === '1';
      const [notifications, unread] = await Promise.all([listNotifications(getPool(), { unreadOnly, limit: 50 }), unreadNotificationCount(getPool())]);
      return send(res, 200, { notifications, unreadCount: unread });
    } catch (err) {
      log.error({ requestId, event: 'notifications_list_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /notifications/unread-count — cheap, layout-shell-friendly.
  if (url.pathname === '/notifications/unread-count' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      return send(res, 200, { unreadCount: await unreadNotificationCount(getPool()) });
    } catch (err) {
      log.error({ requestId, event: 'notifications_unread_count_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // POST /notifications — mark all read.
  if (url.pathname === '/notifications' && req.method === 'POST') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      return send(res, 200, { success: true, updated: await markAllNotificationsRead(getPool()) });
    } catch (err) {
      log.error({ requestId, event: 'notifications_mark_all_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // PATCH /notifications/:id — mark one read.
  if (parts[0] === 'notifications' && parts.length === 2 && req.method === 'PATCH') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      return send(res, 200, { success: await markNotificationRead(getPool(), parts[1]) });
    } catch (err) {
      log.error({ requestId, event: 'notification_mark_read_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /publishing?status=&platform=&limit= — proxies to scheduler-service.
  if (url.pathname === '/publishing' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const { status, data } = await callSchedulerService(`/internal/posts${url.search}`);
      if (status !== 200) return send(res, status, data);
      const items = (data.posts || []).map((p) => ({
        id: p.id, userId: p.userId, contentPreview: (p.content || '').split('\n')[0].slice(0, 120),
        platforms: p.platforms, failedPlatforms: p.failedPlatforms, status: p.status, scheduledAt: p.scheduledAt, updatedAt: p.updatedAt,
      }));
      return send(res, 200, { items, counts: data.counts });
    } catch (err) {
      log.error({ requestId, event: 'publishing_list_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // POST /publishing/:id/retry | /draft — proxies to scheduler-service.
  if (parts[0] === 'publishing' && (parts[2] === 'retry' || parts[2] === 'draft') && parts.length === 3 && req.method === 'POST') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const { status, data } = await callSchedulerService(`/internal/posts/${parts[1]}/${parts[2]}`, { method: 'POST' });
      if (status === 200) logAuditEvent(getPool(), parts[2] === 'retry' ? 'PUBLISH_RETRIED' : 'PUBLISH_MOVED_TO_DRAFT', { meta: { postId: parts[1], actorUserId } });
      return send(res, status, data);
    } catch (err) {
      log.error({ requestId, event: 'publishing_action_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  // GET /dashboard/summary — the Superadmin layout + overview page's one
  // aggregate call, replacing ~8 separate direct DB reads that used to
  // run inside the monolith's SSR render.
  if (url.pathname === '/dashboard/summary' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    try {
      const pool = getPool();
      const [countsRes, recentSignupsRes, flaggedRow, recentAuthEvents, health, ops, recentLogs, publishingRes, unread] = await Promise.all([
        callUserService('/internal/users/counts'),
        callUserService('/internal/users?limit=6'),
        pool.query("SELECT count(*) AS count FROM users WHERE moderation_flagged = true"),
        listAuthEvents(pool, 6),
        getSystemHealth(pool),
        getOpsSummary(pool),
        listSystemLogs(pool, { limit: 8, offset: 0 }),
        callSchedulerService('/internal/posts?limit=1'),
        unreadNotificationCount(pool),
      ]);
      return send(res, 200, {
        counts: countsRes.data?.counts || { total: 0, active: 0, pending: 0, suspended: 0 },
        recentSignups: recentSignupsRes.data?.users || [],
        flaggedUsers: Number(flaggedRow.rows[0]?.count || 0),
        recentAuthEvents,
        health,
        healthIssues: health.filter((h) => h.status !== 'OK').length,
        ops,
        recentLogs: recentLogs.rows,
        failedPublishing: publishingRes.data?.counts?.failed ?? 0,
        unreadNotifications: unread,
      });
    } catch (err) {
      log.error({ requestId, event: 'dashboard_summary_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ADMIN_SERVICE_UNAVAILABLE', message: 'Admin service is temporarily unavailable.' });
    }
  }

  return send(res, 404, { code: 'NOT_FOUND', message: 'No such admin-service route.' });
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
