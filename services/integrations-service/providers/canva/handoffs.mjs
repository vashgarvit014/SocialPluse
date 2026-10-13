// Faithful port of src/lib/canva-handoffs.ts — identical SQL/table
// (oauth_handshakes), identical TTLs. Same persistence, no schema change.

import { randomUUID } from 'node:crypto';

const ONE_HOUR_MS = 60 * 60 * 1000;
// The PKCE verifier must outlive a REAL Canva consent round-trip, not just a
// fast one. It was 10 minutes, which is shorter than the sp_editor_return
// cookie (30 minutes) the same flow writes. A user who has to sign in to Canva,
// hit 2FA, or create an account first routinely spends >10 minutes on Canva's
// screens; the verifier then expires, `takePkceVerifierUser` returns null, and
// a consent that SUCCEEDED is reported to the user as CANVA_STATE_MISMATCH
// ("connection could not be verified") while Canva's freshly-issued code is
// burned and unusable. Matching the cookie's 30 minutes makes the two halves
// of the handshake expire together instead of the code silently outliving its
// own verifier.
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
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
    savePkceVerifier: (userId, state, codeVerifier) => put(userId, `pkce:${state}`, { codeVerifier }, THIRTY_MINUTES_MS),

    async takePkceVerifierUser(state) {
      if (!state) return null;
      const { rows } = await pool.query(
        `DELETE FROM oauth_handshakes WHERE platform = $1 AND state_key = $2 AND expires_at > $3 RETURNING user_id, data`,
        [PLATFORM, `pkce:${state}`, new Date().toISOString()],
      );
      const row = rows[0];
      return row ? { userId: row.user_id, data: row.data || {} } : null;
    },

    // Discards a verifier WITHOUT needing it to still be unexpired. Used on
    // the callback's early-return paths (Canva reported `error`, or code/state
    // were absent): those paths used to `return fail(...)` and leave the row
    // behind, so every cancelled or malformed attempt leaked a row that
    // nothing ever removed. Bounded delete, so a flood of junk states can't
    // turn into an unbounded DELETE.
    async discardPkceVerifier(state) {
      if (!state) return false;
      const { rowCount } = await pool.query(
        `DELETE FROM oauth_handshakes WHERE platform = $1 AND state_key = $2`,
        [PLATFORM, `pkce:${state}`],
      );
      return rowCount > 0;
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

    // Nothing else in the codebase sweeps oauth_handshakes: the only DELETEs
    // are the take/discard paths above, which are keyed to a state the client
    // actually presents. Any attempt that never came back (user closed the
    // tab, Canva never redirected, consent timed out) stayed forever — which
    // is why the live table accumulated stale rows across every connect
    // attempt. Called opportunistically from /auth (the only high-frequency
    // Canva route), bounded so it stays a cheap indexed delete rather than a
    // new background job and its own failure mode. Best-effort: a sweep that
    // fails must never block the user's actual connect.
    async pruneExpired(limit = 50) {
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM oauth_handshakes WHERE id IN (
             SELECT id FROM oauth_handshakes WHERE platform = $1 AND expires_at <= $2 ORDER BY expires_at ASC LIMIT $3
           )`,
          [PLATFORM, new Date().toISOString(), limit],
        );
        return rowCount;
      } catch (err) {
        console.error('[Canva] handshake prune failed (non-fatal):', err instanceof Error ? err.message : err);
        return 0;
      }
    },
  };
}
