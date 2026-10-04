// Phase 12 — cross-cutting Superadmin reporting, moved out of the
// monolith's src/lib/{auth/audit,auth/system-health,auth/user-sessions,
// admin-notifications,system-log-reader}.ts. All READS here against
// tables owned by other services (auth_audit_logs/user_sessions →
// auth-service, ai_usage_log → ai-service) are the same precedent already
// established in Phase 11: cross-cutting reporting reads stay in
// admin-service, writes to those tables stay in the owning service
// (session revoke → auth-service's internal endpoint; nothing here writes
// to a table it doesn't own). admin_notifications and system_logs have no
// other owner, so admin-service both reads and writes them directly.
import { randomUUID } from 'node:crypto';

// ---- auth activity (auth_audit_logs reads) ----

export async function listAuthEvents(pool, limit) {
  const { rows } = await pool.query('SELECT * FROM auth_audit_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(hydrateAuthEvent);
}

export async function listAuthEventsFiltered(pool, { search, event, channel, limit }) {
  const clauses = [];
  const p = [];
  if (search) { p.push(`%${search}%`); clauses.push(`(u.name ILIKE $${p.length} OR u.email ILIKE $${p.length})`); }
  if (event) { p.push(event); clauses.push(`a.event = $${p.length}`); }
  if (channel) { p.push(channel); clauses.push(`a.channel = $${p.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  p.push(limit);
  const { rows } = await pool.query(`
    SELECT a.*, u.name AS user_name, u.email AS user_email
    FROM auth_audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT $${p.length}
  `, p);
  return rows.map((r) => ({ ...hydrateAuthEvent(r), userName: r.user_name, userEmail: r.user_email }));
}

export async function listDistinctAuthEvents(pool) {
  const { rows } = await pool.query('SELECT DISTINCT event FROM auth_audit_logs ORDER BY event ASC');
  return rows.map((r) => r.event);
}

function hydrateAuthEvent(r) {
  return { id: r.id, event: r.event, userId: r.user_id, channel: r.channel, purpose: r.purpose, ip: r.ip, createdAt: r.created_at, meta: r.meta };
}

// ---- active sessions (user_sessions reads; revoke proxies to auth-service) ----

export async function listActiveSessions(pool, limit) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await pool.query(`
    SELECT s.id, s.user_id, u.name AS user_name, u.email AS user_email, s.user_agent, s.ip, s.created_at, s.last_seen_at
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.revoked_at IS NULL AND s.created_at > $1
    ORDER BY s.last_seen_at DESC
    LIMIT $2
  `, [cutoff, limit]);
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, userName: r.user_name, userEmail: r.user_email,
    userAgent: r.user_agent, ip: r.ip, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  }));
}

export async function countActiveSessions(pool) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await pool.query('SELECT count(*) FROM user_sessions WHERE revoked_at IS NULL AND created_at > $1', [cutoff]);
  return Number(rows[0]?.count ?? 0);
}

// ---- system health (own DB + env-presence checks, no live provider calls) ----

function envConfigured(...names) {
  return names.every((n) => !!process.env[n]?.trim()) ? 'OK' : 'NOT_CONFIGURED';
}

export async function getSystemHealth(pool) {
  const checks = [];
  try {
    await pool.query('SELECT 1');
    checks.push({ name: 'Database (PostgreSQL)', status: 'OK', detail: 'Connected' });
  } catch (error) {
    checks.push({ name: 'Database (PostgreSQL)', status: 'ERROR', detail: error instanceof Error ? error.message : 'Connection failed' });
  }
  checks.push({ name: 'SMTP (Email OTP delivery)', status: envConfigured('MAILJET_SMTP_HOST', 'MAILJET_SMTP_USER', 'MAILJET_SMTP_PASS', 'MAIL_FROM'), detail: 'Used for signup/login/password-reset email OTPs' });
  checks.push({ name: 'Meta WhatsApp Cloud API (WhatsApp OTP delivery)', status: envConfigured('META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID'), detail: 'Used ONLY for authentication OTPs — separate from Whapi below' });
  checks.push({ name: 'Whapi (WhatsApp group publishing)', status: envConfigured('WHAPI_API_BASE', 'WHAPI_API_TOKEN'), detail: 'Content publishing to WhatsApp groups — never used for OTP' });
  checks.push({ name: 'Canva', status: envConfigured('CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'), detail: 'Design import integration — validity can only be confirmed by completing Connect in a browser' });
  checks.push({ name: 'LinkedIn', status: envConfigured('LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'), detail: 'Publishing integration' });
  checks.push({ name: 'Facebook', status: envConfigured('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'), detail: 'Publishing integration' });
  checks.push({ name: 'Instagram', status: envConfigured('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'), detail: 'Publishing rides on a connected Facebook Page — same Meta app credentials as Facebook' });
  checks.push({ name: 'WhatsApp Cloud API (content publishing)', status: envConfigured('WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'), detail: 'Separate from Meta WhatsApp OTP delivery above' });
  return checks;
}

// ---- unified ops log (system_logs + auth_audit_logs + ai_usage_log) ----

const INNER_SQL = `
  SELECT s.id::text AS id, s.created_at AS created_at, s.level AS level, s.category AS category, s.event AS event,
         s.user_id::text AS user_id, s.user_email AS user_email, s.platform AS platform, s.resource_id AS resource_id,
         s.message AS message, s.metadata AS metadata, s.request_id AS request_id
  FROM system_logs s
  UNION ALL
  SELECT a.id::text AS id, a.created_at AS created_at,
    CASE WHEN a.event LIKE '%_FAILED' THEN 'ERROR' WHEN a.event LIKE '%_SUCCESS' OR a.event LIKE '%_VERIFIED' THEN 'SUCCESS' ELSE 'INFO' END AS level,
    CASE WHEN a.event IN ('USER_CREATED_BY_ADMIN','ACCOUNT_SUSPENDED','ACCOUNT_REACTIVATED','RESET_ACCESS_TRIGGERED','COLLAB_INVITE_SENT','SESSION_TERMINATED','USER_CREATED','USER_SUSPENDED','USER_REACTIVATED') THEN 'USER'
         WHEN a.event IN ('PUBLISH_RETRIED','PUBLISH_MOVED_TO_DRAFT') THEN 'PUBLISHING' ELSE 'AUTH' END AS category,
    a.event AS event, a.user_id::text AS user_id, u.email AS user_email, NULL AS platform, NULL AS resource_id,
    (a.event || COALESCE(' (' || a.purpose || COALESCE(' via ' || a.channel, '') || ')', '')) AS message, a.meta AS metadata, NULL AS request_id
  FROM auth_audit_logs a LEFT JOIN users u ON u.id = a.user_id
  UNION ALL
  SELECT a2.id::text AS id, a2.created_at AS created_at, CASE WHEN a2.success THEN 'SUCCESS' ELSE 'ERROR' END AS level, 'AI' AS category,
    CASE WHEN a2.success THEN 'AI_GENERATION_SUCCESS' ELSE 'AI_GENERATION_FAILED' END AS event, NULL AS user_id, NULL AS user_email,
    NULL AS platform, NULL AS resource_id, (a2.type || ' generation via ' || a2.provider || ' (' || COALESCE(a2.duration_ms::text, '?') || 'ms)') AS message,
    NULL AS metadata, NULL AS request_id
  FROM ai_usage_log a2
`;

function buildLogWhere(f) {
  const conds = [];
  const params = [];
  const push = (sql, v) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
  if (f.category && f.category !== 'ALL') push('category = ?', f.category);
  if (f.level && f.level !== 'ALL') push('level = ?', f.level);
  if (f.platform && f.platform !== 'ALL') push('platform = ?', f.platform);
  if (f.from) push('created_at >= ?', f.from);
  if (f.to) push('created_at <= ?', f.to);
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`;
    params.push(like, like, like, like);
    const n = params.length;
    conds.push(`(event ILIKE $${n - 3} OR message ILIKE $${n - 2} OR COALESCE(user_email,'') ILIKE $${n - 1} OR COALESCE(resource_id,'') ILIKE $${n})`);
  }
  return { clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export const LOG_PAGE_SIZE = 50;

export async function listSystemLogs(pool, f) {
  const { clause, params } = buildLogWhere(f);
  const limit = Math.min(Math.max(f.limit ?? LOG_PAGE_SIZE, 1), 100);
  const offset = Math.max(f.offset ?? 0, 0);
  const [rowsRes, countedRes] = await Promise.all([
    pool.query(`SELECT * FROM (${INNER_SQL}) u ${clause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    pool.query(`SELECT COUNT(*) AS count FROM (${INNER_SQL}) u ${clause}`, params),
  ]);
  return {
    rows: rowsRes.rows.map((r) => ({
      id: r.id, createdAt: r.created_at, level: r.level, category: r.category, event: r.event,
      userId: r.user_id ?? null, userEmail: r.user_email ?? null, platform: r.platform ?? null,
      resourceId: r.resource_id ?? null, metadata: r.metadata ?? null, requestId: r.request_id ?? null,
    })),
    total: Number(countedRes.rows[0]?.count ?? 0),
  };
}

export async function getOpsSummary(pool) {
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const [e, l, o, a, p] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS count FROM system_logs WHERE level = 'ERROR' AND created_at >= $1`, [dayStart]),
    pool.query(`SELECT COUNT(*) AS count FROM auth_audit_logs WHERE event = 'LOGIN_FAILED' AND created_at >= $1`, [dayStart]),
    pool.query(`SELECT COUNT(*) AS count FROM auth_audit_logs WHERE event IN ('OTP_FAILED','OTP_DELIVERY_FAILED') AND created_at >= $1`, [dayStart]),
    pool.query(`SELECT COUNT(*) AS count FROM ai_usage_log WHERE success = false AND created_at >= $1`, [dayStart]),
    pool.query(`SELECT COUNT(*) AS count FROM system_logs WHERE category = 'PUBLISHING' AND level = 'ERROR' AND created_at >= $1`, [dayStart]),
  ]);
  return {
    errorsToday: Number(e.rows[0]?.count ?? 0),
    failedLoginsToday: Number(l.rows[0]?.count ?? 0),
    failedOtpsToday: Number(o.rows[0]?.count ?? 0),
    failedAiToday: Number(a.rows[0]?.count ?? 0),
    failedPublicationsToday: Number(p.rows[0]?.count ?? 0),
  };
}

// ---- admin notifications (admin-service's own table, no other owner) ----

export async function listNotifications(pool, { unreadOnly, limit } = {}) {
  const { rows } = await pool.query(`
    SELECT n.id, n.type, n.category, n.severity, n.title, n.message, n.user_id, n.is_read, n.created_at, n.read_at,
           u.name AS user_name, u.email AS user_email
    FROM admin_notifications n LEFT JOIN users u ON u.id = n.user_id
    ${unreadOnly ? 'WHERE n.is_read = false' : ''}
    ORDER BY n.created_at DESC
    LIMIT $1
  `, [limit ?? 50]);
  return rows.map((r) => ({
    id: r.id, type: r.type, category: r.category, severity: r.severity, title: r.title, message: r.message,
    userId: r.user_id, userName: r.user_name, userEmail: r.user_email, isRead: r.is_read, createdAt: r.created_at, readAt: r.read_at,
  }));
}

export async function unreadNotificationCount(pool) {
  const { rows } = await pool.query('SELECT count(*) AS count FROM admin_notifications WHERE is_read = false');
  return Number(rows[0]?.count ?? 0);
}

export async function markNotificationRead(pool, id) {
  const { rows } = await pool.query(`UPDATE admin_notifications SET is_read = true, read_at = $2 WHERE id = $1 AND is_read = false RETURNING id`, [id, new Date().toISOString()]);
  return rows.length > 0;
}

export async function markAllNotificationsRead(pool) {
  const { rows } = await pool.query(`UPDATE admin_notifications SET is_read = true, read_at = $1 WHERE is_read = false RETURNING id`, [new Date().toISOString()]);
  return rows.length;
}

export function newId() {
  return randomUUID();
}
