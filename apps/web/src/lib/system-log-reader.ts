import 'server-only';
import { query } from '@/lib/db';
import type { SystemLogRow } from './system-log';

export interface LogFilter {
  category?: string;
  level?: string;
  platform?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const LOG_PAGE_SIZE = 50;

// One unified timeline from all three real sources — no fabricated rows:
//  - system_logs: everything new (media, publishing, platform, system, …)
//  - auth_audit_logs: mapped to AUTH/USER categories (history preserved)
//  - ai_usage_log: mapped to AI category (history preserved)
const INNER_SQL = `
  SELECT
    s.id::text AS id,
    s.created_at AS created_at,
    s.level AS level,
    s.category AS category,
    s.event AS event,
    s.user_id::text AS user_id,
    s.user_email AS user_email,
    s.platform AS platform,
    s.resource_id AS resource_id,
    s.message AS message,
    s.metadata AS metadata,
    s.request_id AS request_id
  FROM system_logs s
  UNION ALL
  SELECT
    a.id::text AS id,
    a.created_at AS created_at,
    CASE
      WHEN a.event LIKE '%_FAILED' THEN 'ERROR'
      WHEN a.event LIKE '%_SUCCESS' OR a.event LIKE '%_VERIFIED' THEN 'SUCCESS'
      ELSE 'INFO'
    END AS level,
    CASE
      WHEN a.event IN ('USER_CREATED_BY_ADMIN','ACCOUNT_SUSPENDED','ACCOUNT_REACTIVATED',
        'RESET_ACCESS_TRIGGERED','COLLAB_INVITE_SENT','SESSION_TERMINATED',
        'USER_CREATED','USER_SUSPENDED','USER_REACTIVATED') THEN 'USER'
      WHEN a.event IN ('PUBLISH_RETRIED','PUBLISH_MOVED_TO_DRAFT') THEN 'PUBLISHING'
      ELSE 'AUTH'
    END AS category,
    a.event AS event,
    a.user_id::text AS user_id,
    u.email AS user_email,
    NULL AS platform,
    NULL AS resource_id,
    (a.event || COALESCE(' (' || a.purpose || COALESCE(' via ' || a.channel, '') || ')', '')) AS message,
    a.meta AS metadata,
    NULL AS request_id
  FROM auth_audit_logs a
  LEFT JOIN users u ON u.id = a.user_id
  UNION ALL
  SELECT
    a2.id::text AS id,
    a2.created_at AS created_at,
    CASE WHEN a2.success THEN 'SUCCESS' ELSE 'ERROR' END AS level,
    'AI' AS category,
    CASE WHEN a2.success THEN 'AI_GENERATION_SUCCESS' ELSE 'AI_GENERATION_FAILED' END AS event,
    NULL AS user_id,
    NULL AS user_email,
    NULL AS platform,
    NULL AS resource_id,
    (a2.type || ' generation via ' || a2.provider || ' (' || COALESCE(a2.duration_ms::text, '?') || 'ms)') AS message,
    NULL AS metadata,
    NULL AS request_id
  FROM ai_usage_log a2
`;

function buildWhere(f: LogFilter): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const push = (sql: string, v: unknown) => {
    params.push(v);
    conds.push(sql.replace('?', `$${params.length}`));
  };
  if (f.category && f.category !== 'ALL') push(`category = ?`, f.category);
  if (f.level && f.level !== 'ALL') push(`level = ?`, f.level);
  if (f.platform && f.platform !== 'ALL') push(`platform = ?`, f.platform);
  if (f.from) push(`created_at >= ?`, f.from);
  if (f.to) push(`created_at <= ?`, f.to);
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`;
    params.push(like, like, like, like);
    const n = params.length;
    conds.push(`(event ILIKE $${n - 3} OR message ILIKE $${n - 2} OR COALESCE(user_email,'') ILIKE $${n - 1} OR COALESCE(resource_id,'') ILIKE $${n})`);
  }
  return { clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

function toRow(r: Record<string, unknown>): SystemLogRow {
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    level: r.level as SystemLogRow['level'],
    category: r.category as SystemLogRow['category'],
    event: String(r.event),
    message: String(r.message),
    userId: (r.user_id as string) ?? null,
    userEmail: (r.user_email as string) ?? null,
    platform: (r.platform as string) ?? null,
    resourceId: (r.resource_id as string) ?? null,
    metadata: (r.metadata as SystemLogRow['metadata']) ?? null,
    requestId: (r.request_id as string) ?? null,
  };
}

export async function listSystemLogs(f: LogFilter): Promise<{ rows: SystemLogRow[]; total: number }> {
  const { clause, params } = buildWhere(f);
  const limit = Math.min(Math.max(f.limit ?? LOG_PAGE_SIZE, 1), 100);
  const offset = Math.max(f.offset ?? 0, 0);
  const [rows, counted] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT * FROM (${INNER_SQL}) u ${clause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM (${INNER_SQL}) u ${clause}`, params),
  ]);
  return { rows: rows.map(toRow), total: Number(counted[0]?.count ?? 0) };
}

export interface OpsSummary {
  errorsToday: number;
  failedLoginsToday: number;
  failedOtpsToday: number;
  failedAiToday: number;
  failedPublicationsToday: number;
}

// Counts are exact per-source queries (cheap COUNTs, no full scans shipped
// to the client). "Failed publications" counts system-log publishing ERRORs
// — the publish routes below log those as they happen.
export async function getOpsSummary(): Promise<OpsSummary> {
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const [[e], [l], [o], [a], [p]] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM system_logs WHERE level = 'ERROR' AND created_at >= $1`, [dayStart]),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM auth_audit_logs WHERE event = 'LOGIN_FAILED' AND created_at >= $1`, [dayStart]),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM auth_audit_logs WHERE event IN ('OTP_FAILED','OTP_DELIVERY_FAILED') AND created_at >= $1`, [dayStart]),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM ai_usage_log WHERE success = false AND created_at >= $1`, [dayStart]),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM system_logs WHERE category = 'PUBLISHING' AND level = 'ERROR' AND created_at >= $1`, [dayStart]),
  ]);
  return {
    errorsToday: Number(e?.count ?? 0),
    failedLoginsToday: Number(l?.count ?? 0),
    failedOtpsToday: Number(o?.count ?? 0),
    failedAiToday: Number(a?.count ?? 0),
    failedPublicationsToday: Number(p?.count ?? 0),
  };
}
