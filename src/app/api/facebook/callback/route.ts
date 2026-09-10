import { NextRequest, NextResponse } from 'next/server';
import { storeFacebookAuth } from '../vault';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/callback';
const GRAPH = 'https://graph.facebook.com/v21.0';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?error=no_code', request.url));
  }

  try {
    // Short-lived user token...
    const shortRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&client_secret=${FACEBOOK_APP_SECRET}&code=${code}`,
    );
    if (!shortRes.ok) {
      return NextResponse.redirect(new URL('/?error=token_exchange_failed', request.url));
    }
    const shortData = await shortRes.json();
    if (!shortData.access_token) {
      return NextResponse.redirect(new URL('/?error=token_exchange_failed', request.url));
    }

    // ...traded for a long-lived one (~60 days), so Page tokens derived from
    // it don't expire after hours.
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&fb_exchange_token=${shortData.access_token}`,
    );
    const longData = await longRes.json().catch(() => ({}));
    const userToken = longData.access_token || shortData.access_token;

    const profileRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(userToken)}`);
    if (!profileRes.ok) {
      return NextResponse.redirect(new URL('/?error=profile_fetch_failed', request.url));
    }
    const profile = await profileRes.json();
    const userId = profile.id || '';
    if (!userId) {
      return NextResponse.redirect(new URL('/?error=profile_fetch_failed', request.url));
    }

    // Pages this user can publish to (needs pages_show_list). Each entry
    // carries its own Page access token - that is what publishes, not the
    // user token.
    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(userToken)}`);
    const pagesData = await pagesRes.json().catch(() => ({}));
    const pages: Array<{ id: string; name: string; accessToken: string }> = Array.isArray(pagesData.data)
      ? pagesData.data.filter((p: { id?: string; access_token?: string }) => p.id && p.access_token)
        .map((p: { id: string; name: string; access_token: string }) => ({ id: p.id, name: p.name || 'Page', accessToken: p.access_token }))
      : [];
    if (pages.length === 0) {
      // Connected, but there is no Page to publish to - send them back with
      // a clear reason instead of a dead "connected" state.
      return NextResponse.redirect(new URL('/?error=no_facebook_page', request.url));
    }

    // Tokens stay server-side only. The browser gets the user id plus the
    // Page id/name list (no secrets) for the account card + page picker.
    storeFacebookAuth(userId, userToken, pages);

    const params = new URLSearchParams({
      platform: 'facebook',
      connected: 'true',
      name: profile.name || 'Facebook',
      email: '',
      user_id: userId,
      pages: JSON.stringify(pages.map(p => ({ id: p.id, name: p.name }))),
    });

    return NextResponse.redirect(new URL(`/?${params.toString()}`, request.url));
  } catch {
    return NextResponse.redirect(new URL('/?error=callback_failed', request.url));
  }
}
