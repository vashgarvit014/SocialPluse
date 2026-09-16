import { NextRequest, NextResponse } from 'next/server';
import { getLinkedInToken, getAnyLinkedInToken, deleteLinkedInToken } from '../vault';

// Real connection status, computed server-side from the token vault - never
// trust the client's cached name/email. localStorage can go stale (e.g. a
// browser that hit a broken post-OAuth redirect before it could update, or
// a token that was later disconnected/expired/revoked on LinkedIn's side)
// and would otherwise keep showing a "Connected" card for an account that
// can no longer actually publish anything.
//
// `userId` is optional: when the browser has no cached id at all (nothing
// was ever written to *this* tab's localStorage - e.g. OAuth completed in a
// different tab), fall back to whatever single account the vault holds
// rather than reporting disconnected forever with no way to self-heal.
export async function GET(request: NextRequest) {
  const requestedUserId = request.nextUrl.searchParams.get('userId');
  const resolved = requestedUserId
    ? (() => { const t = getLinkedInToken(requestedUserId); return t ? { userId: requestedUserId, accessToken: t } : null; })()
    : getAnyLinkedInToken();
  if (!resolved) return NextResponse.json({ connected: false });
  const { userId, accessToken } = resolved;

  try {
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      // Only a genuine 401 means the token itself is dead (expired/revoked) -
      // clean that up so it doesn't linger as a confusing "connected but
      // every publish fails" state. Anything else (429 rate limit, 5xx,
      // etc.) is inconclusive and must NOT delete a possibly-still-valid
      // token - this status route is now called on every page load across
      // every open tab, and a transient LinkedIn-side hiccup deleting a
      // real, hard-to-reacquire token is a much worse outcome than briefly
      // under-reporting "connected" for one check.
      if (profileResponse.status === 401) deleteLinkedInToken(userId);
      return NextResponse.json({ connected: false });
    }

    const profile = await profileResponse.json();
    return NextResponse.json({
      connected: true,
      userId,
      name: profile.name || '',
      email: profile.email || '',
    });
  } catch {
    // Network hiccup reaching LinkedIn - don't delete a possibly-still-valid
    // token over a transient failure, just report this check as inconclusive.
    return NextResponse.json({ connected: false });
  }
}
