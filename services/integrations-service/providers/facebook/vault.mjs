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
      if (!userId || !providerUserId || !userToken) return;
      const now = new Date().toISOString();
      const credentials = {
        userToken,
        pages: pages.map((p) => ({
          id: p.id, name: p.name, accessToken: p.accessToken,
          ...(p.instagramAccountId ? { instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername } : {}),
        })),
      };
      await pool.query(
        `INSERT INTO platform_connections
           (id, user_id, platform, provider_user_id, display_name, email, credentials, meta, created_at, updated_at, disconnected_at)
         VALUES ($1, $2, 'facebook', $3, $4, NULL, $5, $6, $7, $7, NULL)
         ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
           DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name,
                         credentials = EXCLUDED.credentials, meta = EXCLUDED.meta, updated_at = EXCLUDED.updated_at`,
        [randomUUID(), userId, providerUserId, pages[0]?.name ?? null, JSON.stringify(credentials), JSON.stringify({ pageCount: pages.length }), now],
      );
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
    async getInstagramAccount(userId, pageId) {
      const { rows } = await pool.query(
        `SELECT credentials FROM platform_connections WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL`,
        [userId],
      );
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
  };
}
