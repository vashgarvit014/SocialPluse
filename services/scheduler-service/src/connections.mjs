// Publish-time connection preflight.
//
// Runs BEFORE any provider publish call so that a user who disconnected a
// platform after scheduling never has an outbound publish attempted for it —
// the requirement is that disconnect intent is authoritative even when the
// underlying token would still work at the provider.
//
// Every query is scoped by `user_id = $1`. There is deliberately no
// "find connection by platform" path anywhere in this file: a scheduled post
// must never resolve another user's credentials.

// Connection-error codes are kept identical to the ones publishing-service
// already returns (LINKEDIN_NOT_CONNECTED, etc.) so the worker's error
// classification has ONE vocabulary whether the rejection came from this
// preflight or from publishing-service itself.
const NOT_CONNECTED = {
  linkedin: 'LINKEDIN_NOT_CONNECTED',
  facebook: 'FACEBOOK_NOT_CONNECTED',
  instagram: 'INSTAGRAM_NOT_CONNECTED',
  whatsapp: 'WHATSAPP_NOT_CHANNEL_OWNER',
};

const RECONNECT_MESSAGE = {
  linkedin: 'LinkedIn is disconnected.',
  facebook: 'Facebook is disconnected.',
  instagram: 'Instagram is disconnected.',
  whatsapp: 'WhatsApp is disconnected.',
};

const PLATFORM_LABEL = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp' };

export function createConnectionChecker(pool) {
  /**
   * @returns {Promise<{ok:true, connectionId:string|null, destination:string|null, displayName:string|null}>
   *                |{ok:false, code:string, message:string}>}
   */
  async function preflight(userId, platform, account = {}) {
    if (!userId) {
      return { ok: false, code: 'PLATFORM_NOT_CONNECTED', message: 'This post has no owning user.' };
    }

    if (platform === 'linkedin') {
      const { rows } = await pool.query(
        `SELECT id, display_name, credentials->>'accessToken' AS has_token
           FROM platform_connections
          WHERE user_id = $1 AND platform = 'linkedin' AND disconnected_at IS NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );
      const row = rows[0];
      if (!row) return notConnected('linkedin');
      if (!row.has_token) return notConnected('linkedin');
      return { ok: true, connectionId: row.id, destination: account.userId || null, displayName: row.display_name || null };
    }

    if (platform === 'facebook') {
      const { rows } = await pool.query(
        `SELECT id, display_name, credentials
           FROM platform_connections
          WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );
      const row = rows[0];
      if (!row) return notConnected('facebook');
      const pages = Array.isArray(row.credentials?.pages) ? row.credentials.pages : [];
      if (pages.length === 0) return notConnected('facebook');
      const page = (account.pageId && pages.find((p) => p.id === account.pageId)) || pages[0];
      if (!page?.id || !page.accessToken) return notConnected('facebook');
      return { ok: true, connectionId: row.id, destination: page.id, displayName: row.display_name || null };
    }

    if (platform === 'instagram') {
      // Instagram has no OAuth of its own — it is derived from the connected
      // Facebook Page, AND it carries a per-user opt-out (meta.instagramDisabled)
      // set by the user's own Disconnect action. Both must hold.
      const { rows } = await pool.query(
        `SELECT id, display_name, credentials, meta
           FROM platform_connections
          WHERE user_id = $1 AND platform = 'facebook' AND disconnected_at IS NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );
      const row = rows[0];
      if (!row) return notConnected('instagram');
      if (row.meta?.instagramDisabled === true) return notConnected('instagram');
      const pages = Array.isArray(row.credentials?.pages) ? row.credentials.pages : [];
      const page = (account.pageId && pages.find((p) => p.id === account.pageId)) || pages.find((p) => p.instagramAccountId) || pages[0];
      if (!page?.instagramAccountId || !page.accessToken) return notConnected('instagram');
      return { ok: true, connectionId: row.id, destination: page.instagramAccountId, displayName: row.display_name || null };
    }

    if (platform === 'whatsapp') {
      const { rows } = await pool.query(
        `SELECT id, account_name, provider_channel_id
           FROM whatsapp_connections
          WHERE user_id = $1 AND status = 'CONNECTED' AND channel_token IS NOT NULL
          ORDER BY connected_at DESC NULLS LAST LIMIT 1`,
        [userId],
      );
      const row = rows[0];
      if (!row) return notConnected('whatsapp');
      const destination = account.pageId || account.groupId || row.provider_channel_id || null;
      if (!destination) return notConnected('whatsapp');
      return { ok: true, connectionId: row.id, destination, displayName: row.account_name || null };
    }

    return { ok: false, code: 'UNSUPPORTED_PLATFORM', message: `Unknown platform ${platform}.` };
  }

  function notConnected(platform) {
    return {
      ok: false,
      code: NOT_CONNECTED[platform] || 'PLATFORM_NOT_CONNECTED',
      message: `${RECONNECT_MESSAGE[platform] || `${PLATFORM_LABEL[platform] || platform} is disconnected.`} Reconnect ${PLATFORM_LABEL[platform] || platform} to publish this scheduled post.`,
    };
  }

  /**
   * Display names for every platform the user currently has connected — used
   * by the disconnect-warning endpoint ("Instagram has 4 scheduled posts").
   */
  async function connectedPlatforms(userId) {
    if (!userId) return [];
    const { rows } = await pool.query(
      `SELECT platform FROM platform_connections WHERE user_id = $1 AND disconnected_at IS NULL`,
      [userId],
    );
    const have = new Set(rows.map((r) => r.platform));
    const { rows: wa } = await pool.query(
      `SELECT 1 FROM whatsapp_connections WHERE user_id = $1 AND status = 'CONNECTED' AND channel_token IS NOT NULL LIMIT 1`,
      [userId],
    );
    if (wa.length) have.add('whatsapp');
    return [...have];
  }

  return { preflight, connectedPlatforms };
}
