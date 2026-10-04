// Faithful port of src/lib/oauth-state.ts — same table (oauth_handshakes),
// same TTL, same state format. Shared by LinkedIn and (later) Facebook,
// exactly as the monolith does.
import { randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 30 * 60 * 1000;
const VALID_STATE = /^[A-Za-z0-9_-]{32,128}$/;

export function generateOAuthState() {
  return randomBytes(32).toString('base64url');
}

export function createOAuthStateStore(pool) {
  return {
    async saveOAuthState(platform, userId, data = {}) {
      const state = generateOAuthState();
      await pool.query(
        `INSERT INTO oauth_handshakes (id, user_id, platform, state_key, data, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomBytes(16).toString('hex').replace(/(.{8})(.{8})(.{8})(.{8})/, '$1-$2-$3-$4'),
          userId, platform, state, JSON.stringify(data),
          new Date().toISOString(), new Date(Date.now() + STATE_TTL_MS).toISOString(),
        ],
      );
      return state;
    },

    async consumeOAuthState(platform, state) {
      if (!state || !VALID_STATE.test(state)) return null;
      const { rows } = await pool.query(
        `DELETE FROM oauth_handshakes WHERE state_key = $1 AND platform = $2 AND expires_at > $3 RETURNING user_id, data`,
        [state, platform, new Date().toISOString()],
      );
      const row = rows[0];
      return row ? { userId: row.user_id, data: row.data || {} } : null;
    },
  };
}

export function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
