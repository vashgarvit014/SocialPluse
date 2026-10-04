// Faithful port of src/app/api/linkedin/vault.ts — same table
// (platform_connections), same upsert-on-conflict semantics. NOT the legacy
// linkedin-tokens.json (that file is already unused by the monolith itself;
// see the original file's own comment — nothing to migrate there).

import { randomUUID } from 'node:crypto';

export function createLinkedInVault(pool) {
  return {
    async storeLinkedInToken(userId, providerUserId, accessToken, meta = {}) {
      if (!userId || !providerUserId || !accessToken) return;
      const now = new Date().toISOString();
      await pool.query(
        `INSERT INTO platform_connections
           (id, user_id, platform, provider_user_id, display_name, email, credentials, meta, created_at, updated_at, disconnected_at)
         VALUES ($1, $2, 'linkedin', $3, $4, $5, $6, $7, $8, $8, NULL)
         ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
           DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name,
                         email = EXCLUDED.email, credentials = EXCLUDED.credentials, updated_at = EXCLUDED.updated_at`,
        [randomUUID(), userId, providerUserId, meta.displayName ?? null, meta.email ?? null, JSON.stringify({ accessToken }), JSON.stringify({}), now],
      );
    },

    async getLinkedInToken(userId) {
      const { rows } = await pool.query(
        `SELECT credentials FROM platform_connections WHERE user_id = $1 AND platform = 'linkedin' AND disconnected_at IS NULL`,
        [userId],
      );
      const creds = rows[0]?.credentials;
      return (creds && typeof creds.accessToken === 'string') ? creds.accessToken : null;
    },

    async deleteLinkedInToken(userId) {
      const { rows } = await pool.query(
        `UPDATE platform_connections SET disconnected_at = $2, updated_at = $2
          WHERE user_id = $1 AND platform = 'linkedin' AND disconnected_at IS NULL RETURNING id`,
        [userId, new Date().toISOString()],
      );
      return rows.length > 0;
    },
  };
}
