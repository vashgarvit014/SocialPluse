// Faithful port of src/lib/auth/user-sessions.ts.
import { randomUUID } from 'node:crypto';

const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

export function createUserSessionsRepo(pool) {
  return {
    async createUserSession(userId, userAgent, ip) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await pool.query(
        'INSERT INTO user_sessions (id, user_id, user_agent, ip, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)',
        [id, userId, userAgent, ip, now],
      );
      return id;
    },

    // Combines the revocation check and a throttled last-seen touch into one
    // query. A missing row (e.g. manually deleted) is treated as revoked,
    // failing closed.
    async touchAndCheckSession(sessionId) {
      const now = new Date().toISOString();
      const throttleCutoff = new Date(Date.now() - TOUCH_THROTTLE_MS).toISOString();
      const { rows } = await pool.query(`
        UPDATE user_sessions
        SET last_seen_at = CASE WHEN last_seen_at < $2 THEN $3 ELSE last_seen_at END
        WHERE id = $1
        RETURNING revoked_at
      `, [sessionId, throttleCutoff, now]);
      return !!rows[0] && rows[0].revoked_at === null;
    },

    async revokeSession(sessionId) {
      await pool.query('UPDATE user_sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL', [new Date().toISOString(), sessionId]);
    },
  };
}
