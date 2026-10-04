// Credential resolution for publishing-service, reading the SAME
// platform_connections / whatsapp_connections tables integrations-service
// owns (shared Postgres) — not a live HTTP hop to integrations-service for
// every publish call. This is a deliberate choice, not an oversight: both
// services already read the same DB in this phase of the migration, and a
// publish request is latency-sensitive in a way connection management
// isn't. "publishing-service -> integrations-service internal contract" is
// the brief's PREFERRED shape, not mandatory — revisit if/when
// integrations-service's credential rows need logic beyond a row read
// (e.g. an automatic refresh) that publishing-service would otherwise have
// to duplicate.
//
// Faithful port of the token-bearing reads: src/app/api/linkedin/vault.ts
// #getLinkedInAuth, platform-connections.ts#getFacebookPageToken/
// getInstagramAccount. These intentionally DO return tokens (unlike
// integrations-service's own vault copies, which strip them for the
// public-facing status/list views) — this is the one place in the whole
// migration tokens are read back out, same as the original.

export function createCredentialsStore(pool) {
  return {
    async getLinkedInAuth(userId) {
      const { rows } = await pool.query(
        `SELECT provider_user_id, credentials FROM platform_connections WHERE user_id = $1 AND platform = 'linkedin' AND disconnected_at IS NULL`,
        [userId],
      );
      const row = rows[0];
      if (!row) return null;
      const accessToken = typeof row.credentials?.accessToken === 'string' ? row.credentials.accessToken : '';
      if (!accessToken) return null;
      return { providerUserId: row.provider_user_id, accessToken };
    },

    // Mirrors platform-connections.ts#getFacebookPageToken: resolves ONE
    // Page's token, optionally narrowed by pageId (always within this
    // user's own Pages — pageId never selects across users).
    async getFacebookPageToken(userId, pageId) {
      const { rows } = await pool.query(
        `SELECT credentials FROM platform_connections WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL`,
        [userId],
      );
      const pages = rows[0]?.credentials?.pages;
      if (!Array.isArray(pages) || pages.length === 0) return null;
      const page = (pageId && pages.find((p) => p.id === pageId)) || pages[0];
      if (!page?.id || !page?.accessToken) return null;
      return { pageId: page.id, token: page.accessToken };
    },

    // Mirrors platform-connections.ts#getInstagramAccount exactly.
    async getInstagramAccount(userId, pageId) {
      const { rows } = await pool.query(
        `SELECT credentials FROM platform_connections WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL`,
        [userId],
      );
      const pages = rows[0]?.credentials?.pages;
      if (!Array.isArray(pages) || pages.length === 0) return null;
      const page = (pageId && pages.find((p) => p.id === pageId)) || pages.find((p) => p.instagramAccountId);
      if (!page?.instagramAccountId || !page.accessToken) return null;
      return { igUserId: page.instagramAccountId, username: page.instagramUsername || '', pageId: page.id, pageName: page.name, token: page.accessToken };
    },

    // Mirrors whatsapp-connections.ts#getConnectedChannel/getConnectedOwnerByToken
    // — the SAME single-channel ownership model WhatsApp connection logic uses.
    async getConnectedWhatsAppChannel(userId) {
      const { rows } = await pool.query(
        `SELECT channel_token, provider_channel_id FROM whatsapp_connections WHERE user_id = $1 AND status = 'CONNECTED' AND channel_token IS NOT NULL`,
        [userId],
      );
      const row = rows[0];
      if (!row?.channel_token) return null;
      return { token: row.channel_token, channelId: row.provider_channel_id || undefined };
    },

    async getWhatsAppChannelOwner(token) {
      const { rows } = await pool.query(
        `SELECT user_id FROM whatsapp_connections WHERE channel_token = $1 AND status = 'CONNECTED' ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
        [token],
      );
      return rows[0]?.user_id || null;
    },
  };
}
