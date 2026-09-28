import { finishReturn, invalidReturnState } from '@/lib/oauth-return';
import { NextRequest } from 'next/server';
import { storeFacebookAuth } from '../vault';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/callback';
const GRAPH = 'https://graph.facebook.com/v21.0';
// Next dev (bound with -H 0.0.0.0) bakes its own bind address into
// request.url inside route handlers, ignoring the incoming Host header - so
// new URL(path, request.url) resolves to http://0.0.0.0:3001/... behind the
// Cloudflare tunnel instead of the public domain. Derive the redirect origin
// from our own registered redirect URI instead (same fix already applied to
// LinkedIn's callback and originally used by Canva's APP_ORIGIN).
const APP_ORIGIN = new URL(FACEBOOK_REDIRECT_URI).origin;

export async function GET(request: NextRequest) {
  if (invalidReturnState(request)) return finishReturn(request, new URL('/dashboard?error=state_mismatch', APP_ORIGIN));
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  // Facebook's own dialog-level failures (e.g. an App Domains/redirect
  // mismatch) arrive as error_code/error_message instead of the standard
  // OAuth `error` param - surface the real reason instead of falling
  // through to a generic "no_code" that hides what actually went wrong.
  const errorCode = searchParams.get('error_code');
  const errorMessage = searchParams.get('error_message');

  if (error) {
    return finishReturn(request, new URL(`/dashboard?error=${error}`, APP_ORIGIN));
  }

  if (errorCode || errorMessage) {
    console.error(`[facebook/callback] dialog error ${errorCode}: ${errorMessage}`);
    return finishReturn(request, new URL(`/dashboard?error=${encodeURIComponent(errorMessage || errorCode || 'facebook_dialog_error')}`, APP_ORIGIN));
  }

  if (!code) {
    return finishReturn(request, new URL('/dashboard?error=no_code', APP_ORIGIN));
  }

  try {
    // Short-lived user token...
    const shortRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}&client_secret=${FACEBOOK_APP_SECRET}&code=${code}`,
    );
    if (!shortRes.ok) {
      return finishReturn(request, new URL('/dashboard?error=token_exchange_failed', APP_ORIGIN));
    }
    const shortData = await shortRes.json();
    if (!shortData.access_token) {
      return finishReturn(request, new URL('/dashboard?error=token_exchange_failed', APP_ORIGIN));
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
      return finishReturn(request, new URL('/dashboard?error=profile_fetch_failed', APP_ORIGIN));
    }
    const profile = await profileRes.json();
    const userId = profile.id || '';
    if (!userId) {
      return finishReturn(request, new URL('/dashboard?error=profile_fetch_failed', APP_ORIGIN));
    }

    // Pages this user can publish to (needs pages_show_list). Each entry
    // carries its own Page access token - that is what publishes, not the
    // user token. instagram_business_account (needs instagram_basic, granted
    // above) tells us which Page has an Instagram Business/Creator account
    // linked - most Pages won't, and that's fine, Instagram just stays
    // unavailable for those.
    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=50&access_token=${encodeURIComponent(userToken)}`);
    const pagesData = await pagesRes.json().catch(() => ({}));
    const rawPages: Array<{ id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string } }> =
      Array.isArray(pagesData.data) ? pagesData.data.filter((p: { id?: string; access_token?: string }) => p.id && p.access_token) : [];

    // A Page's instagram_business_account only carries an id - a second call
    // per linked Page (with that Page's own token) gets the @username to
    // show in the UI. Page count here is small (handful at most), so doing
    // this sequentially at connect-time is fine; it's not on any hot path.
    const pages: Array<{ id: string; name: string; accessToken: string; instagramAccountId?: string; instagramUsername?: string }> = [];
    for (const p of rawPages) {
      const igId = p.instagram_business_account?.id;
      let igUsername: string | undefined;
      if (igId) {
        try {
          const igRes = await fetch(`${GRAPH}/${igId}?fields=username&access_token=${encodeURIComponent(p.access_token as string)}`);
          if (igRes.ok) igUsername = (await igRes.json()).username;
        } catch { /* username is cosmetic - publishing still works without it */ }
      }
      pages.push({ id: p.id as string, name: p.name || 'Page', accessToken: p.access_token as string, ...(igId ? { instagramAccountId: igId, instagramUsername: igUsername } : {}) });
    }
    if (pages.length === 0) {
      // Connected, but there is no Page to publish to - send them back with
      // a clear reason instead of a dead "connected" state.
      return finishReturn(request, new URL('/dashboard?error=no_facebook_page', APP_ORIGIN));
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

    return finishReturn(request, new URL(`/dashboard?${params.toString()}`, APP_ORIGIN));
  } catch {
    return finishReturn(request, new URL('/dashboard?error=callback_failed', APP_ORIGIN));
  }
}
