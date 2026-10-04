import { createOAuthStateStore } from '../../packages/oauth-state/index.mjs';
import { startReturn, finishReturn, clearReturnCookie } from '../../src/oauth-return.mjs';
import { parseCookies } from '../../packages/cookies/index.mjs';
import { createLinkedInVault } from './vault.mjs';

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/linkedin/callback';
const APP_ORIGIN = new URL(LINKEDIN_REDIRECT_URI).origin;
const WEB_UPSTREAM = process.env.WEB_UPSTREAM || 'http://socialpulse:3000';
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

// Bridges to the monolith for the one piece of disconnect behavior that
// isn't integrations-service's domain: scrubbing stored-token copies out of
// this user's OWN scheduled posts (scheduler/publishing's table, not
// platform_connections). Duplicating scrubUserPostAccounts()'s legacy-JSON-
// import + scheduled_posts logic here would be the wrong owner for it — see
// Canva's /export, left in the monolith for the same reason. This is a
// small enough dependency to bridge via one internal call instead.
async function scrubViaMonolith(userId, platform, providerUserId, requestId) {
  try {
    const res = await fetch(`${WEB_UPSTREAM}/api/internal/scrub-post-accounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'x-request-id': requestId },
      body: JSON.stringify({ userId, platform, providerUserId }),
    });
    const data = await res.json().catch(() => ({}));
    return typeof data.scrubbedPosts === 'number' ? data.scrubbedPosts : 0;
  } catch {
    return 0; // Best-effort, same as the rest of disconnect not being transactional in the original.
  }
}

export function createLinkedInRouter(pool) {
  const oauthState = createOAuthStateStore(pool);
  const vault = createLinkedInVault(pool);

  return async function handleLinkedInRoute(pathname, req, res, { requestId, isHttps }) {
    const url = new URL(req.url, 'http://internal');
    const cookies = parseCookies(req.headers.cookie || '');

    // --- GET /auth ---
    if (pathname === '/auth' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const scope = 'openid profile email w_member_social';
      const state = await oauthState.saveOAuthState('linkedin', userId);
      const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
        `response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(LINKEDIN_REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}`;
      startReturn(cookies, res, state, isHttps);
      return redirect(res, authUrl);
    }

    // --- GET /callback — no actor requirement; identity comes from the
    // state row, exactly like src/app/api/linkedin/callback/route.ts. ---
    if (pathname === '/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const requestState = url.searchParams.get('state');
      const fail = (errCode) => {
        const target = finishReturn(req.headers.cookie || '', requestState, new URL(`/dashboard?error=${errCode}`, APP_ORIGIN));
        clearReturnCookie(res, isHttps);
        return redirect(res, target.toString());
      };

      const state = await oauthState.consumeOAuthState('linkedin', requestState);
      if (!state) return fail('state_mismatch');
      const appUserId = state.userId;
      if (error) return fail(error);
      if (!code) return fail('no_code');

      try {
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: LINKEDIN_REDIRECT_URI, client_id: LINKEDIN_CLIENT_ID, client_secret: LINKEDIN_CLIENT_SECRET }),
        });
        if (!tokenResponse.ok) return fail('token_exchange_failed');
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!profileResponse.ok) return fail('profile_fetch_failed');
        const profileData = await profileResponse.json();
        const providerUserId = profileData.sub || '';

        await vault.storeLinkedInToken(appUserId, providerUserId, accessToken, { displayName: profileData.name || null, email: profileData.email || null });

        const params = new URLSearchParams({ platform: 'linkedin', connected: 'true', name: profileData.name || '', email: profileData.email || '', user_id: providerUserId });
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
      const accessToken = await vault.getLinkedInToken(userId);
      if (!accessToken) return json(res, 200, { connected: false });
      try {
        const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!profileResponse.ok) {
          if (profileResponse.status === 401) await vault.deleteLinkedInToken(userId);
          return json(res, 200, { connected: false });
        }
        const profile = await profileResponse.json();
        return json(res, 200, { connected: true, userId: profile.sub || '', name: profile.name || '', email: profile.email || '' });
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
        if (body.platform !== 'linkedin') {
          return json(res, 400, { success: false, code: 'UNSUPPORTED_PLATFORM', message: 'Only LinkedIn disconnect is supported.' });
        }
        const providerUserId = typeof body.userId === 'string' && body.userId ? body.userId : null;
        const removed = await vault.deleteLinkedInToken(userId);
        const scrubbedPosts = await scrubViaMonolith(userId, 'linkedin', providerUserId, requestId);
        return json(res, 200, { success: true, disconnected: removed, scrubbedPosts });
      } catch {
        return json(res, 500, { success: false, code: 'DISCONNECT_FAILED', message: 'Failed to disconnect LinkedIn.' });
      }
    }

    return null;
  };
}
