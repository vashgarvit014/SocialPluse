import { NextResponse } from 'next/server';
import { getFacebookAuth, deleteFacebookAuth } from '../vault';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Real connection status, computed server-side from the token vault - same
// pattern as linkedin/status. Without this, the frontend had no way to
// re-verify a Facebook connection after the initial OAuth-redirect toast, so
// a stale/missing localStorage cache (different tab, a reload, etc.) would
// show "Not connected" even when the vault still held a working token.
//
// Identity comes from the session only. This route used to accept ?userId=
// and probe the vault with it, falling back to "whichever account was
// connected most recently" - so a brand-new user was shown the PREVIOUS
// user's Facebook profile name and full Page list, and a guessed ?userId=
// made the route delete that account's stored token on a 401.
export async function GET(): Promise<Response> {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const found = await getFacebookAuth(session.userId);
  if (!found) return NextResponse.json({ connected: false });
  const auth = { userId: found.providerUserId, userToken: found.userToken, pages: found.pages };

  try {
    const profileResponse = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(auth.userToken)}`);

    if (!profileResponse.ok) {
      // Only a genuine 401 means the token itself is dead - anything else
      // (rate limit, 5xx) is inconclusive and must not delete a possibly-
      // still-valid token, since this route is now called on every page
      // load across every open tab. See the same fix in linkedin/status
      // for the real incident this guards against.
      if (profileResponse.status === 401) {
        await deleteFacebookAuth(session.userId);
        logSystem({ level: 'INFO', category: 'PLATFORM', event: 'FACEBOOK_TOKEN_EXPIRED', userId: session.userId, platform: 'facebook', message: 'Facebook token rejected by provider; connection cleared' });
      }
      return NextResponse.json({ connected: false });
    }

    const profile = await profileResponse.json();
    return NextResponse.json({
      connected: true,
      userId: auth.userId,
      name: profile.name || '',
      pages: auth.pages,
    });
  } catch {
    // Network hiccup reaching Facebook - don't delete a possibly-still-valid
    // token over a transient failure, just report this check as inconclusive.
    return NextResponse.json({ connected: false });
  }
}
