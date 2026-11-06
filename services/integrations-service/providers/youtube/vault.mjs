import { randomUUID } from 'node:crypto';

export function createYouTubeVault(pool) {
  return {
    async getConnection(userId, { includeDisconnected = false } = {}) {
      const { rows } = await pool.query(
        `SELECT id, user_id, provider_user_id, display_name, credentials, meta, disconnected_at
           FROM platform_connections
          WHERE user_id = $1 AND platform = 'youtube' ${includeDisconnected ? '' : 'AND disconnected_at IS NULL'}
          ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );
      return rows[0] || null;
    },

    async storeConnection(userId, channel, credentials, channels) {
      if (!userId || !channel?.id || !credentials?.accessToken) return { ok: false, reason: 'missing' };
      const now = new Date().toISOString();
      const meta = { thumbnail: channel.thumbnail || '', authorizedChannels: channels, privacyStatus: channel.privacyStatus || null };
      const { rows } = await pool.query(
        `INSERT INTO platform_connections
           (id, user_id, platform, provider_user_id, display_name, email, credentials, meta, created_at, updated_at, disconnected_at)
         VALUES ($1, $2, 'youtube', $3, $4, NULL, $5, $6, $7, $7, NULL)
         ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
           DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name,
                         credentials = EXCLUDED.credentials, meta = EXCLUDED.meta,
                         updated_at = EXCLUDED.updated_at, disconnected_at = NULL
           WHERE platform_connections.user_id = EXCLUDED.user_id
         RETURNING id, user_id`,
        [randomUUID(), userId, channel.id, channel.name || 'YouTube Channel', JSON.stringify(credentials), JSON.stringify(meta), now],
      );
      return rows.length ? { ok: true, id: rows[0].id } : { ok: false, reason: 'already_connected_elsewhere' };
    },

    async updateCredentials(userId, credentials) {
      const { rows } = await pool.query(
        `UPDATE platform_connections SET credentials = $2, updated_at = $3
          WHERE user_id = $1 AND platform = 'youtube' AND disconnected_at IS NULL RETURNING id`,
        [userId, JSON.stringify(credentials), new Date().toISOString()],
      );
      return rows.length > 0;
    },

    async updateChannels(userId, channels) {
      const active = channels[0];
      const { rows } = await pool.query(
        `UPDATE platform_connections
            SET provider_user_id = $2, display_name = $3,
                meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb, updated_at = $5
          WHERE user_id = $1 AND platform = 'youtube' AND disconnected_at IS NULL RETURNING id`,
        [userId, active?.id || '', active?.name || 'YouTube Channel', JSON.stringify({ thumbnail: active?.thumbnail || '', authorizedChannels: channels }), new Date().toISOString()],
      );
      return rows.length > 0;
    },

    async disconnect(userId) {
      const { rows } = await pool.query(
        `UPDATE platform_connections SET disconnected_at = $2, updated_at = $2, credentials = '{}'::jsonb
          WHERE user_id = $1 AND platform = 'youtube' AND disconnected_at IS NULL RETURNING id`,
        [userId, new Date().toISOString()],
      );
      return rows.length > 0;
    },
  };
}
