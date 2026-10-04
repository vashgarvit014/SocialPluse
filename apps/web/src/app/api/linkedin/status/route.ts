import { NextResponse } from 'next/server';
import { getLinkedInToken, deleteLinkedInToken } from '../vault';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

// Real connection status, computed server-side from the token vault - never
// trust the client's cached name/email. localStorage can go stale (e.g. a
// browser that hit a broken post-OAuth redirect before it could update, or
// a token that was later disconnected/expired/revoked on LinkedIn's side)
// and would otherwise keep showing a "Connected" card for an account that
// can no longer actually publish anything.
//
// Identity comes from the session only. This route used to accept ?userId= and
// probe the vault with it, falling back to "whichever account was connected
// most recently" - so a new user was shown the PREVIOUS user's LinkedIn
// profile name and email, and a guessed ?userId= made the route delete that
// account's stored token on a 401. There is no query param and no fallback.
export async function GET(): Promise<Response> {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const accessToken = await getLinkedInToken(session.userId);
  if (!accessToken) return NextResponse.json({ connected: false });

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
      if (profileResponse.status === 401) {
        await deleteLinkedInToken(session.userId);
        logSystem({ level: 'INFO', category: 'PLATFORM', event: 'LINKEDIN_TOKEN_EXPIRED', userId: session.userId, platform: 'linkedin', message: 'LinkedIn token rejected by provider; connection cleared' });
      }
      return NextResponse.json({ connected: false });
    }

    const profile = await profileResponse.json();
    return NextResponse.json({
      connected: true,
      userId: profile.sub || '',
      name: profile.name || '',
      email: profile.email || '',
    });
  } catch {
    // Network hiccup reaching LinkedIn - don't delete a possibly-still-valid
    // token over a transient failure, just report this check as inconclusive.
    return NextResponse.json({ connected: false });
  }
}