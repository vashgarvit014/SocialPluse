// Faithful port of src/lib/canva-handoffs.ts — identical SQL/table
// (oauth_handshakes), identical TTLs. Same persistence, no schema change.

import { randomUUID } from 'node:crypto';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const PLATFORM = 'canva';

export function createHandoffStore(pool) {
  async function put(userId, key, data, ttlMs) {
    const now = new Date();
    await pool.query(
      `INSERT INTO oauth_handshakes (id, user_id, platform, state_key, data, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), userId, PLATFORM, key, JSON.stringify(data), now.toISOString(), new Date(now.getTime() + ttlMs).toISOString()],
    );
  }

  async function take(userId, key) {
    if (!key) return null;
    const { rows } = await pool.query(
      `DELETE FROM oauth_handshakes WHERE user_id = $1 AND platform = $2 AND state_key = $3 AND expires_at > $4 RETURNING data`,
      [userId, PLATFORM, key, new Date().toISOString()],
    );
    return rows[0]?.data ?? null;
  }

  async function peek(userId, key) {
    if (!key) return null;
    const { rows } = await pool.query(
      `SELECT data FROM oauth_handshakes WHERE user_id = $1 AND platform = $2 AND state_key = $3 AND expires_at > $4`,
      [userId, PLATFORM, key, new Date().toISOString()],
    );
    return rows[0]?.data ?? null;
  }

  return {
    savePkceVerifier: (userId, state, codeVerifier) => put(userId, `pkce:${state}`, { codeVerifier }, TEN_MINUTES_MS),

    async takePkceVerifierUser(state) {
      if (!state) return null;
      const { rows } = await pool.query(
        `DELETE FROM oauth_handshakes WHERE platform = $1 AND state_key = $2 AND expires_at > $3 RETURNING user_id, data`,
        [PLATFORM, `pkce:${state}`, new Date().toISOString()],
      );
      const row = rows[0];
      return row ? { userId: row.user_id, data: row.data || {} } : null;
    },

    savePendingDesign: (userId, correlationState, designId) => put(userId, `pending:${correlationState}`, { designId }, ONE_HOUR_MS),

    async takePendingDesign(userId, correlationState) {
      const entry = await take(userId, `pending:${correlationState}`);
      return entry?.designId ?? null;
    },

    async takePendingDesignById(userId, designId) {
      if (!designId) return null;
      const { rows } = await pool.query(
        `DELETE FROM oauth_handshakes WHERE user_id = $1 AND platform = $2 AND state_key LIKE 'pending:%' AND data->>'designId' = $3 AND expires_at > $4 RETURNING state_key`,
        [userId, PLATFORM, designId, new Date().toISOString()],
      );
      return rows.length > 0 ? designId : null;
    },

    saveReadyDesign: (userId, readyId, designId) => put(userId, `ready:${readyId}`, { designId }, ONE_HOUR_MS),

    async takeReadyDesign(userId, readyId) {
      const entry = await take(userId, `ready:${readyId}`);
      return entry?.designId ?? null;
    },

    async peekReadyDesign(userId, readyId) {
      const entry = await peek(userId, `ready:${readyId}`);
      return entry?.designId ?? null;
    },
  };
}
