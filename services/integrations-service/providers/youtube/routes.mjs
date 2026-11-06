import { createOAuthStateStore } from '../../packages/oauth-state/index.mjs';
import { parseCookies } from '../../packages/cookies/index.mjs';
import { startReturn, finishReturn, clearReturnCookie } from '../../src/oauth-return.mjs';
import {
  buildYouTubeAuthorizationUrl,
  exchangeYouTubeCode,
  listMyYouTubeChannels,
  refreshYouTubeToken,
  revokeYouTubeToken,
  tokenCredentials,
  tokenNeedsRefresh,
  youtubeConfig,
  youtubeConfigMissing,
} from '../../packages/youtube/index.mjs';
import { createYouTubeVault } from './vault.mjs';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId ? userId : null;
}

async function featureAccess(pool, userId, config) {
  if (!config.enabled) return { allowed: false, reason: 'feature_disabled' };
  const { rows } = await pool.query('SELECT email FROM users WHERE id = $1 LIMIT 1', [userId]);
  const email = String(rows[0]?.email || '').toLowerCase();
  if (!email || !config.allowedEmails.has(email)) return { allowed: false, reason: 'not_allowlisted' };
  return { allowed: true, email };
}

export function createYouTubeRouter(pool, deps = {}) {
  const config = deps.config || youtubeConfig();
  const fetchImpl = deps.fetchImpl || fetch;
  const oauthState = createOAuthStateStore(pool);
  const vault = createYouTubeVault(pool);
  const appOrigin = config.redirectUri ? new URL(config.redirectUri).origin : 'http://localhost:3000';

  async function activeCredentials(userId, connection) {
    let credentials = connection.credentials || {};
    if (tokenNeedsRefresh(credentials)) {
      if (!credentials.refreshToken) return null;
      const refreshed = await refreshYouTubeToken(config, credentials.refreshToken, fetchImpl);
      credentials = tokenCredentials(refreshed, credentials);
      await vault.updateCredentials(userId, credentials);
    }
    return credentials;
  }

  return async function handleYouTubeRoute(pathname, req, res, { isHttps }) {
    const url = new URL(req.url, 'http://internal');
    const cookies = parseCookies(req.headers.cookie || '');

    if (pathname === '/auth' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { code: 'UNAUTHORIZED', message: 'Sign in required.' });
      const missing = youtubeConfigMissing(config);
      if (missing.length) return json(res, 503, { code: 'YOUTUBE_NOT_CONFIGURED', message: `YouTube is not configured. Missing: ${missing.join(', ')}.` });
      const access = await featureAccess(pool, userId, config);
      if (!access.allowed) return json(res, 403, { code: 'YOUTUBE_NOT_AVAILABLE', message: 'YouTube is currently limited to approved test users.' });
      const state = await oauthState.saveOAuthState('youtube', userId);
      startReturn(cookies, res, state, isHttps);
      return redirect(res, buildYouTubeAuthorizationUrl(config, state));
    }

    if (pathname === '/callback' && req.method === 'GET') {
      const requestState = url.searchParams.get('state');
      const fail = (code) => {
        const target = finishReturn(req.headers.cookie || '', requestState, new URL(`/dashboard?error=${encodeURIComponent(code)}`, appOrigin));
        clearReturnCookie(res, isHttps);
        return redirect(res, target.toString());
      };
      const state = await oauthState.consumeOAuthState('youtube', requestState);
      if (!state) return fail('state_mismatch');
      if (url.searchParams.get('error')) return fail(url.searchParams.get('error'));
      const code = url.searchParams.get('code');
      if (!code) return fail('no_code');
      const access = await featureAccess(pool, state.userId, config);
      if (!access.allowed) return fail('youtube_not_available');

      try {
        const previous = await vault.getConnection(state.userId);
        const token = await exchangeYouTubeCode(config, code, fetchImpl);
        const credentials = tokenCredentials(token, previous?.credentials || {});
        const channels = await listMyYouTubeChannels(credentials.accessToken, fetchImpl);
        if (!channels.length) return fail('youtube_channel_not_found');
        const stored = await vault.storeConnection(state.userId, channels[0], credentials, channels);
        if (!stored.ok) return fail(stored.reason === 'already_connected_elsewhere' ? 'account_already_connected' : 'youtube_store_failed');
        const params = new URLSearchParams({ platform: 'youtube', connected: 'true', name: channels[0].name, user_id: channels[0].id });
        const target = finishReturn(req.headers.cookie || '', requestState, new URL(`/dashboard?${params}`, appOrigin));
        clearReturnCookie(res, isHttps);
        return redirect(res, target.toString());
      } catch {
        return fail('youtube_callback_failed');
      }
    }

    if (pathname === '/status' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { code: 'UNAUTHORIZED', message: 'Sign in required.' });
      const missing = youtubeConfigMissing(config);
      const access = await featureAccess(pool, userId, config);
      if (missing.length || !access.allowed) return json(res, 200, { available: false, connected: false, reason: missing.length ? 'not_configured' : access.reason });
      const connection = await vault.getConnection(userId);
      if (!connection) return json(res, 200, { available: true, connected: false });
      try {
        const credentials = await activeCredentials(userId, connection);
        if (!credentials) return json(res, 200, { available: true, connected: false, reconnectRequired: true });
        const channels = await listMyYouTubeChannels(credentials.accessToken, fetchImpl);
        if (!channels.length) return json(res, 200, { available: true, connected: false, reconnectRequired: true });
        await vault.updateChannels(userId, channels);
        return json(res, 200, { available: true, connected: true, userId: channels[0].id, name: channels[0].name, thumbnail: channels[0].thumbnail, channels });
      } catch (error) {
        const reconnectRequired = error?.status === 400 || error?.status === 401;
        return json(res, 200, { available: true, connected: false, reconnectRequired });
      }
    }

    if (pathname === '/disconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { code: 'UNAUTHORIZED', message: 'Sign in required.' });
      const connection = await vault.getConnection(userId);
      if (!connection) return json(res, 200, { success: true, disconnected: false });
      const token = connection.credentials?.refreshToken || connection.credentials?.accessToken;
      await revokeYouTubeToken(token, fetchImpl).catch(() => false);
      const disconnected = await vault.disconnect(userId);
      return json(res, 200, { success: true, disconnected });
    }

    return null;
  };
}
