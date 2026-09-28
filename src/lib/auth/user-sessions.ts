import 'server-only';
import { randomUUID } from 'node:crypto';
import { query, queryOne } from '@/lib/db';

const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

// One row per real login (created alongside, never instead of, the
// stateless JWT session cookie — see session.ts). Exists purely so a
// Superadmin can see who is currently logged in and revoke a specific
// session; the JWT itself remains the actual credential.
export async function createUserSession(userId: string, userAgent: string | null, ip: string | null): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await query(
    'INSERT INTO user_sessions (id, user_id, user_agent, ip, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)',
    [id, userId, userAgent, ip, now],
  );
  return id;
}

// Called on every authenticated request that carries a sessionId claim
// (see dal.ts#verifySession). Combines the revocation check and a
// throttled last-seen touch into one query so this adds at most one extra
// indexed lookup per request — not one query for the check plus another
// for the touch. A missing row (e.g. manually deleted) is treated as
// revoked, failing closed.
export async function touchAndCheckSession(sessionId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const throttleCutoff = new Date(Date.now() - TOUCH_THROTTLE_MS).toISOString();
  const row = await queryOne<{ revoked_at: string | null }>(`
    UPDATE user_sessions
    SET last_seen_at = CASE WHEN last_seen_at < $2 THEN $3 ELSE last_seen_at END
    WHERE id = $1
    RETURNING revoked_at
  `, [sessionId, throttleCutoff, now]);
  return !!row && row.revoked_at === null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query('UPDATE user_sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL', [new Date().toISOString(), sessionId]);
}

export interface ActiveSessionItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

// "Active" = not revoked and not older than the JWT's own 7-day expiry
// (see session.ts#SESSION_DURATION_MS) — an expired-but-not-revoked row
// would otherwise linger here even though its cookie can no longer verify.
export async function listActiveSessions(limit: number): Promise<ActiveSessionItem[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await query<{
    id: string; user_id: string; user_name: string; user_email: string;
    user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string;
  }>(`
    SELECT s.id, s.user_id, u.name AS user_name, u.email AS user_email, s.user_agent, s.ip, s.created_at, s.last_seen_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.revoked_at IS NULL AND s.created_at > $1
    ORDER BY s.last_seen_at DESC
    LIMIT $2
  `, [cutoff, limit]);
  return rows.map(r => ({
    id: r.id, userId: r.user_id, userName: r.user_name, userEmail: r.user_email,
    userAgent: r.user_agent, ip: r.ip, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  }));
}

export async function countActiveSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = await queryOne<{ count: string }>('SELECT count(*) FROM user_sessions WHERE revoked_at IS NULL AND created_at > $1', [cutoff]);
  return Number(row?.count ?? 0);
}
