import { finishReturn, invalidReturnState } from '@/lib/oauth-return';
import { NextRequest } from 'next/server';
import { storeLinkedInToken } from '../vault';

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
  if (invalidReturnState(request)) return finishReturn(request, new URL('/?error=state_mismatch', APP_ORIGIN));
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return finishReturn(request, new URL(`/?error=${error}`, APP_ORIGIN));
  }

  if (!code) {
    return finishReturn(request, new URL('/?error=no_code', APP_ORIGIN));
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
      return finishReturn(request, new URL('/?error=token_exchange_failed', APP_ORIGIN));
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      return finishReturn(request, new URL('/?error=profile_fetch_failed', APP_ORIGIN));
    }

    const profileData = await profileResponse.json();
    const userId = profileData.sub || '';

    // Store the token server-side only. The browser receives the user id
    // (no access token in URL, storage, or API responses).
    storeLinkedInToken(userId, accessToken);

    const params = new URLSearchParams({
      platform: 'linkedin',
      connected: 'true',
      name: profileData.name || '',
      email: profileData.email || '',
      user_id: userId,
    });

    return finishReturn(request, new URL(`/?${params.toString()}`, APP_ORIGIN));
  } catch (error) {
    return finishReturn(request, new URL('/?error=callback_failed', APP_ORIGIN));
  }
}
