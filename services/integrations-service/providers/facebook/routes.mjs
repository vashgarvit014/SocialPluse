import { createOAuthStateStore } from '../../packages/oauth-state/index.mjs';
import { startReturn, finishReturn, clearReturnCookie } from '../../src/oauth-return.mjs';
import { parseCookies } from '../../packages/cookies/index.mjs';
import { createFacebookVault } from './vault.mjs';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/callback';
const FACEBOOK_LOGIN_CONFIG_ID = process.env.FACEBOOK_LOGIN_CONFIG_ID || '';
const APP_ORIGIN = new URL(FACEBOOK_REDIRECT_URI).origin;
const GRAPH = 'https://graph.facebook.com/v21.0';
const SCHEDULER_SERVICE_URL = process.env.SCHEDULER_SERVICE_URL || 'http://scheduler-service:4007';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

// Same bridge pattern as LinkedIn's disconnect — scrubUserPostAccounts()
// belongs to scheduler/publishing, not integrations-service.
async function scrubViaScheduler(userId, platform, providerUserId, requestId) {
  try {
    const res = await fetch(`${SCHEDULER_SERVICE_URL}/internal/scrub-post-accounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'x-request-id': requestId },
      body: JSON.stringify({ userId, platform, providerUserId }),
    });
    const data = await res.json().catch(() => ({}));
    return typeof data.scrubbedPosts === 'number' ? data.scrubbedPosts : 0;
  } catch {
    return 0;
  }
}

export function createFacebookRouter(pool) {
  const oauthState = createOAuthStateStore(pool);
  const vault = createFacebookVault(pool);

  return async function handleFacebookRoute(pathname, req, res, { requestId, isHttps }) {
    const url = new URL(req.url, 'http://internal');
    const cookies = parseCookies(req.headers.cookie || '');

    // --- GET /auth ---
    if (pathname === '/auth' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      if (!FACEBOOK_APP_ID) {
        return json(res, 500, { error: { code: 'FACEBOOK_NOT_CONFIGURED', message: 'Facebook App ID is not configured. Add FACEBOOK_APP_ID to .env.local.' } });
      }
      if (!FACEBOOK_LOGIN_CONFIG_ID) {
        return json(res, 500, { error: { code: 'FACEBOOK_NOT_CONFIGURED', message: 'FACEBOOK_LOGIN_CONFIG_ID is not configured. Add it to .env.local (App Dashboard > Facebook Login for Business > Configurations).' } });
      }
      const state = await oauthState.saveOAuthState('facebook', userId);
      const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
        `client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&config_id=${encodeURIComponent(FACEBOOK_LOGIN_CONFIG_ID)}&response_type=code&state=${state}`;
      startReturn(cookies, res, state, isHttps);
      return redirect(res, authUrl);
    }

    // --- GET /callback — no actor requirement; identity from state row. ---
    if (pathname === '/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const errorCode = url.searchParams.get('error_code');
      const errorMessage = url.searchParams.get('error_message');
      const requestState = url.searchParams.get('state');
      const fail = (errCode) => {
        const target = finishReturn(req.headers.cookie || '', requestState, new URL(`/dashboard?error=${errCode}`, APP_ORIGIN));
        clearReturnCookie(res, isHttps);
        return redirect(res, target.toString());
      };

      const state = await oauthState.consumeOAuthState('facebook', requestState);
      if (!state) return fail('state_mismatch');
      const appUserId = state.userId;
      if (error) return fail(error);
      if (errorCode || errorMessage) {
        console.error(`[integrations-service] facebook callback dialog error ${errorCode}: ${errorMessage}`);
        return fail(encodeURIComponent(errorMessage || errorCode || 'facebook_dialog_error'));
      }
      if (!code) return fail('no_code');

      try {
        const shortRes = await fetch(`${GRAPH}/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&client_secret=${FACEBOOK_APP_SECRET}&code=${code}`);
        if (!shortRes.ok) return fail('token_exchange_failed');
        const shortData = await shortRes.json();
        if (!shortData.access_token) return fail('token_exchange_failed');

        const longRes = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&fb_exchange_token=${shortData.access_token}`);
        const longData = await longRes.json().catch(() => ({}));
        const userToken = longData.access_token || shortData.access_token;

        const profileRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(userToken)}`);
        if (!profileRes.ok) return fail('profile_fetch_failed');
        const profile = await profileRes.json();
        const providerUserId = profile.id || '';
        if (!providerUserId) return fail('profile_fetch_failed');

        const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=50&access_token=${encodeURIComponent(userToken)}`);
        const pagesData = await pagesRes.json().catch(() => ({}));
        const rawPages = Array.isArray(pagesData.data) ? pagesData.data.filter((p) => p.id && p.access_token) : [];

        const pages = [];
        for (const p of rawPages) {
          const igId = p.instagram_business_account?.id;
          let igUsername;
          if (igId) {
            try {
              const igRes = await fetch(`${GRAPH}/${igId}?fields=username&access_token=${encodeURIComponent(p.access_token)}`);
              if (igRes.ok) igUsername = (await igRes.json()).username;
            } catch { /* username is cosmetic */ }
          }
          pages.push({ id: p.id, name: p.name || 'Page', accessToken: p.access_token, ...(igId ? { instagramAccountId: igId, instagramUsername: igUsername } : {}) });
        }
        if (pages.length === 0) return fail('no_facebook_page');

        await vault.storeFacebookAuth(appUserId, providerUserId, userToken, pages);

        const params = new URLSearchParams({
          platform: 'facebook', connected: 'true', name: profile.name || 'Facebook', email: '', user_id: providerUserId,
          pages: JSON.stringify(pages.map((p) => ({ id: p.id, name: p.name }))),
        });
        const target = finishReturn(req.headers.cookie || '', requestState, new URL(`/dashboard?${params.toString()}`, APP_ORIGIN));
        clearReturnCookie(res, isHttps);
        return redirect(res, target.toString());
      } catch {
        return fail('callback_failed');
      }
    }

    // --- GET /status ---
    if (pathname === '/status' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const found = await vault.getFacebookAuth(userId);
      if (!found) return json(res, 200, { connected: false });
      try {
        const profileResponse = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(found.userToken)}`);
        if (!profileResponse.ok) {
          if (profileResponse.status === 401) await vault.deleteFacebookAuth(userId);
          return json(res, 200, { connected: false });
        }
        const profile = await profileResponse.json();
        return json(res, 200, { connected: true, userId: found.providerUserId, name: profile.name || '', pages: found.pages });
      } catch {
        return json(res, 200, { connected: false });
      }
    }

    // --- POST /disconnect ---
    if (pathname === '/disconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (body.platform !== 'facebook') {
          return json(res, 400, { success: false, code: 'UNSUPPORTED_PLATFORM', message: 'Only Facebook disconnect is supported.' });
        }
        const providerUserId = typeof body.userId === 'string' && body.userId ? body.userId : null;
        await vault.deleteFacebookAuth(userId);
        const scrubbedPosts = await scrubViaScheduler(userId, 'facebook', providerUserId, requestId);
        return json(res, 200, { success: true, scrubbedPosts });
      } catch {
        return json(res, 500, { success: false, code: 'DISCONNECT_FAILED', message: 'Failed to disconnect Facebook.' });
      }
    }

    return null;
  };
}
