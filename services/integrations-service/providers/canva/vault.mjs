// Server-side credential store for Canva — same table (platform_connections),
// same upsert-on-conflict/ownership semantics as the LinkedIn and Facebook
// vaults in this directory's siblings. Canva previously kept its access/
// refresh tokens in httpOnly browser cookies (see canva.mjs's now-removed
// setTokenCookies); that worked per-browser but not per-user: a second
// browser, a background job, or two SocialPulse accounts sharing one browser
// all broke or leaked. This vault is the fix — one row per connected user,
// looked up by (and only by) their authenticated userId.

import { randomUUID } from 'node:crypto';

export function createCanvaVault(pool) {
  return {
    // providerUserId = Canva's team_user.user_id (GET /v1/users/me) — the
    // stable identity Canva itself assigns, independent of display name.
    async storeCanvaAuth(userId, providerUserId, credentials, meta = {}) {
      if (!userId || !providerUserId || !credentials?.accessToken) return { ok: false, reason: 'missing' };
      const now = new Date().toISOString();
      const { rows } = await pool.query(
        `INSERT INTO platform_connections
           (id, user_id, platform, provider_user_id, display_name, email, credentials, meta, created_at, updated_at, disconnected_at)
         VALUES ($1, $2, 'canva', $3, $4, NULL, $5, $6, $7, $7, NULL)
         ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
           DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name,
                         credentials = EXCLUDED.credentials, meta = EXCLUDED.meta, updated_at = EXCLUDED.updated_at
           WHERE platform_connections.user_id = EXCLUDED.user_id
         RETURNING user_id`,
        [randomUUID(), userId, providerUserId, meta.displayName ?? null, JSON.stringify(credentials), JSON.stringify(meta), now],
      );
      // Row count 0 means the conflicting live row belongs to a DIFFERENT
      // SocialPulse user — same atomic-arbiter guard as LinkedIn/Facebook.
      // Refusing to reassign is what stops one user's Canva OAuth from
      // silently stealing another user's already-connected account.
      if (rows.length === 0) return { ok: false, reason: 'already_connected_elsewhere' };
      return { ok: true };
    },

    async getCanvaAuth(userId) {
      const { rows } = await pool.query(
        `SELECT provider_user_id, display_name, credentials, meta
           FROM platform_connections WHERE user_id = $1 AND platform = 'canva' AND disconnected_at IS NULL`,
        [userId],
      );
      const row = rows[0];
      if (!row) return null;
      const creds = row.credentials || {};
      if (typeof creds.accessToken !== 'string') return null;
      return {
        providerUserId: row.provider_user_id,
        displayName: row.display_name,
        accessToken: creds.accessToken,
        refreshToken: typeof creds.refreshToken === 'string' ? creds.refreshToken : null,
        expiresAt: typeof creds.expiresAt === 'number' ? creds.expiresAt : 0,
        scope: typeof creds.scope === 'string' ? creds.scope : null,
        meta: row.meta || {},
      };
    },

    // Called after a transparent token refresh — rotates the stored
    // access/refresh token pair without touching provider_user_id/meta.
    // Canva rotates refresh tokens on every use (reusing a consumed one
    // revokes the whole lineage), so persisting the NEW refresh_token here
    // every time is load-bearing, not optional.
    async updateCanvaCredentials(userId, credentials) {
      const now = new Date().toISOString();
      const { rows } = await pool.query(
        `UPDATE platform_connections SET credentials = $3, updated_at = $2
          WHERE user_id = $1 AND platform = 'canva' AND disconnected_at IS NULL RETURNING id`,
        [userId, now, JSON.stringify(credentials)],
      );
      return rows.length > 0;
    },

    async deleteCanvaAuth(userId) {
      const { rows } = await pool.query(
        `UPDATE platform_connections SET disconnected_at = $2, updated_at = $2
          WHERE user_id = $1 AND platform = 'canva' AND disconnected_at IS NULL RETURNING id`,
        [userId, new Date().toISOString()],
      );
      return rows.length > 0;
    },
  };
}
