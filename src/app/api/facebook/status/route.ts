import { NextRequest, NextResponse } from 'next/server';
import { getFacebookAuth, getAnyFacebookAuth, deleteFacebookAuth } from '../vault';
import { requireApiSession } from '@/lib/auth/api';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Real connection status, computed server-side from the token vault - same
// pattern as linkedin/status. Without this, the frontend had no way to
// re-verify a Facebook connection after the initial OAuth-redirect toast, so
// a stale/missing localStorage cache (different tab, a reload, etc.) would
// show "Not connected" even when the vault still held a working token.
//
// Unlike LinkedIn's status route, `userId` here is optional: when the
// browser has no cached id at all (nothing was ever written to *this* tab's
// localStorage), fall back to whatever single account the vault holds
// rather than reporting disconnected forever with no way to self-heal.
export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const requestedUserId = request.nextUrl.searchParams.get('userId');
  let auth: { userId: string; userToken: string; pages: Array<{ id: string; name: string }> } | null;
  if (requestedUserId) {
    const found = getFacebookAuth(requestedUserId);
    auth = found ? { userId: requestedUserId, ...found } : null;
  } else {
    auth = getAnyFacebookAuth();
  }
  if (!auth) return NextResponse.json({ connected: false });

  try {
    const profileResponse = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(auth.userToken)}`);

    if (!profileResponse.ok) {
      // Only a genuine 401 means the token itself is dead - anything else
      // (rate limit, 5xx) is inconclusive and must not delete a possibly-
      // still-valid token, since this route is now called on every page
      // load across every open tab. See the same fix in linkedin/status
      // for the real incident this guards against.
      if (profileResponse.status === 401) deleteFacebookAuth(auth.userId);
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
