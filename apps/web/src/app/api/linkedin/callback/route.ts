import { finishReturn } from '@/lib/oauth-return';
import { NextRequest } from 'next/server';
import { storeLinkedInToken } from '../vault';
import { consumeOAuthState } from '@/lib/oauth-state';
import { logSystem } from '@/lib/system-log';

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/linkedin/callback';
// Next dev (bound with -H 0.0.0.0) bakes its own bind address into
// request.url inside route handlers, ignoring the incoming Host header - so
// new URL(path, request.url) resolves to http://0.0.0.0:3001/... behind the
// Cloudflare tunnel instead of the public domain. Derive the redirect origin
// from our own registered redirect URI instead (same fix already used by
// Canva's APP_ORIGIN in src/lib/canva.ts).
const APP_ORIGIN = new URL(LINKEDIN_REDIRECT_URI).origin;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // The state row is the ONLY thing binding this callback to a SocialPulse
  // account, and consuming it is what proves the flow was started by that user.
  // It replaces invalidReturnState(), which reported a missing return cookie
  // as VALID and therefore skipped the check entirely on a direct hit.
  const state = await consumeOAuthState('linkedin', searchParams.get('state'));
  if (!state) {
    logSystem({ level: 'WARN', category: 'PLATFORM', event: 'OAUTH_STATE_INVALID', platform: 'linkedin', message: 'LinkedIn callback rejected: unknown or expired state' });
    return finishReturn(request, new URL('/dashboard?error=state_mismatch', APP_ORIGIN));
  }
  const appUserId = state.userId;

  if (error) {
    return finishReturn(request, new URL(`/dashboard?error=${error}`, APP_ORIGIN));
  }

  if (!code) {
    return finishReturn(request, new URL('/dashboard?error=no_code', APP_ORIGIN));
  }

  try {
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      return finishReturn(request, new URL('/dashboard?error=token_exchange_failed', APP_ORIGIN));
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      return finishReturn(request, new URL('/dashboard?error=profile_fetch_failed', APP_ORIGIN));
    }

    const profileData = await profileResponse.json();
    // The PROVIDER's member id, stored alongside the app user who owns it.
    const providerUserId = profileData.sub || '';

    // Store the token server-side only, bound to the user who started the flow
    // (appUserId) — never to the provider id alone, which was how one user's
    // connection became the default account for everyone.
    await storeLinkedInToken(appUserId, providerUserId, accessToken, {
      displayName: profileData.name || null,
      email: profileData.email || null,
    });
    logSystem({ level: 'SUCCESS', category: 'PLATFORM', event: 'LINKEDIN_CONNECTED', userId: appUserId, platform: 'linkedin', message: 'LinkedIn account connected' });

    const params = new URLSearchParams({
      platform: 'linkedin',
      connected: 'true',
      name: profileData.name || '',
      email: profileData.email || '',
      user_id: providerUserId,
    });

    return finishReturn(request, new URL(`/dashboard?${params.toString()}`, APP_ORIGIN));
  } catch (error) {
    return finishReturn(request, new URL('/dashboard?error=callback_failed', APP_ORIGIN));
  }
}
