// Faithful port of src/app/api/facebook/vault.ts + the Facebook-relevant
// parts of src/lib/platform-connections.ts (saveConnection/getConnection/
// disconnectPlatform) — same table (platform_connections), same credentials
// shape: { userToken, pages: [{ id, name, accessToken, instagramAccountId?,
// instagramUsername? }] }. getFacebookPageToken (publish-time) is NOT ported
// — publish stays in the monolith this round. getInstagramAccount IS ported
// here (not duplicated in providers/instagram/) since Instagram has no
// platform_connections row of its own — it reads this exact table/row. The
// Instagram provider imports it from here, same as the monolith's
// src/app/api/instagram/status/route.ts imports from '../../facebook/vault'.

import { randomUUID } from 'node:crypto';

export function createFacebookVault(pool) {
  return {
    async storeFacebookAuth(userId, providerUserId, userToken, pages) {
      if (!userId || !providerUserId || !userToken) return { ok: false, reason: 'missing' };
      // Same rule as the LinkedIn vault, enforced atomically in the single
      // statement below: same-user re-auth refreshes; a cross-user reassign
      // writes nothing and reports the conflict instead of silently stealing
      // the row out from under its current owner.
      const now = new Date().toISOString();
      const credentials = {
        userToken,
        pages: pages.map((p) => ({
          id: p.id, name: p.name, accessToken: p.accessToken,
          ...(p.instagramAccountId ? { instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername } : {}),
        })),
      };
      const { rows } = await pool.query(
        `INSERT INTO platform_connections
           (id, user_id, platform, provider_user_id, display_name, email, credentials, meta, created_at, updated_at, disconnected_at)
         VALUES ($1, $2, 'facebook', $3, $4, NULL, $5, $6, $7, $7, NULL)
         ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
           DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name,
                         credentials = EXCLUDED.credentials, meta = EXCLUDED.meta, updated_at = EXCLUDED.updated_at
           WHERE platform_connections.user_id = EXCLUDED.user_id
         RETURNING user_id`,
        [randomUUID(), userId, providerUserId, pages[0]?.name ?? null, JSON.stringify(credentials), JSON.stringify({ pageCount: pages.length }), now],
      );
      if (rows.length === 0) return { ok: false, reason: 'already_connected_elsewhere' };
      return { ok: true };
    },

    // Mirrors platform-connections.ts#getFacebookAuth: reads the connection
    // row, returns null if there are no Pages (same "connected but useless"
    // guard as the original).
    async getFacebookAuth(userId) {
      const { rows } = await pool.query(
        `SELECT provider_user_id, credentials FROM platform_connections WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL`,
        [userId],
      );
      const row = rows[0];
      if (!row) return null;
      const creds = row.credentials || {};
      const pages = Array.isArray(creds.pages) ? creds.pages : [];
      if (pages.length === 0) return null;
      return {
        providerUserId: row.provider_user_id,
        userToken: typeof creds.userToken === 'string' ? creds.userToken : '',
        pages: pages.map((p) => ({
          id: p.id, name: p.name,
          ...(p.instagramAccountId ? { instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername } : {}),
        })),
      };
    },

    // Mirrors platform-connections.ts#getInstagramAccount exactly, INCLUDING
    // the Page access token (getFacebookAuth above deliberately omits it —
    // this is the one place that token is read back out, same as original).
    //
    // PLUS the user's own Instagram opt-out: `meta.instagramDisabled` is set
    // by POST /instagram/disconnect. Instagram has no OAuth of its own, so
    // without this the Disconnect button would be a no-op and a user who
    // "disconnected Instagram" would still be published to from a scheduled
    // post. Disconnect intent is authoritative here even though the Facebook
    // Page token underneath would still work at Meta.
    async getInstagramAccount(userId, pageId) {
      const { rows } = await pool.query(
        `SELECT credentials, meta FROM platform_connections WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL`,
        [userId],
      );
      if (rows[0]?.meta?.instagramDisabled === true) return null;
      const creds = rows[0]?.credentials;
      const pages = creds && Array.isArray(creds.pages) ? creds.pages : [];
      if (pages.length === 0) return null;
      const page = (pageId && pages.find((p) => p.id === pageId)) || pages.find((p) => p.instagramAccountId);
      if (!page?.instagramAccountId || !page.accessToken) return null;
      return { igUserId: page.instagramAccountId, username: page.instagramUsername || '', pageId: page.id, pageName: page.name, token: page.accessToken };
    },

    async deleteFacebookAuth(userId) {
      const { rows } = await pool.query(
        `UPDATE platform_connections SET disconnected_at = $2, updated_at = $2
          WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL RETURNING id`,
        [userId, new Date().toISOString()],
      );
      return rows.length > 0;
    },

    // The user's own Instagram opt-out, stored on the Facebook row Instagram
    // derives from (meta is preserved as an object — only the key we own is
    // touched, so pageCount and any other meta survive).
    async setInstagramDisabled(userId, disabled) {
      const now = new Date().toISOString();
      const { rows } = await pool.query(
        `UPDATE platform_connections
            SET meta = CASE WHEN $3 THEN COALESCE(meta, '{}'::jsonb) || '{"instagramDisabled": true}'::jsonb
                            ELSE COALESCE(meta, '{}'::jsonb) - 'instagramDisabled' END,
                updated_at = $2
          WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL
          RETURNING id`,
        [userId, now, disabled === true],
      );
      return rows.length > 0;
    },

    async getInstagramDisabled(userId) {
      const { rows } = await pool.query(
        `SELECT meta FROM platform_connections WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL`,
        [userId],
      );
      if (!rows[0]) return null; // no Facebook connection at all
      return rows[0].meta?.instagramDisabled === true;
    },
  };
}
