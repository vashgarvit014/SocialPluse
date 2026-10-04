import { NextResponse } from 'next/server';
import { getFacebookAuth, getInstagramAccount } from '../../facebook/vault';
import { requireApiSession } from '@/lib/auth/api';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Instagram has no account of its own here - it's derived from whichever of
// THE SESSION USER'S Facebook Pages has an Instagram Business account linked.
// Same pattern: computed server-side, never trusted from client cache.
//
// This route used to accept ?userId= and fall back to "whichever Facebook
// account was connected most recently", so a new user was shown the previous
// user's Instagram handle and Page name. Identity now comes from the session
// only, with no fallback and no query parameter.
export async function GET(): Promise<Response> {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const found = await getFacebookAuth(session.userId);
  if (!found) return NextResponse.json({ connected: false });
  const resolved = { userId: found.providerUserId, pages: found.pages };

  const ig = await getInstagramAccount(session.userId);
  if (!ig) {
    // Facebook is connected, but no Page has an Instagram Business/Creator
    // account linked - a real, common state (most Pages don't), not an
    // error. Surface why, so the UI can explain it instead of just showing
    // "Not connected" with no further clue.
    return NextResponse.json({ connected: false, reason: 'NO_LINKED_INSTAGRAM_ACCOUNT' });
  }

  try {
    // Live-verify the Page token can still reach the linked IG account
    // (catches a revoked/expired Page token, or the IG link having been
    // removed on Meta's side since we last stored it).
    const res = await fetch(`${GRAPH}/${ig.igUserId}?fields=username&access_token=${encodeURIComponent(ig.token)}`);
    if (!res.ok) {
      // Inconclusive (rate limit, transient 5xx) vs. genuinely broken both
      // just report disconnected here - there's nothing to delete (this
      // data lives inside the Facebook vault entry, not its own record), so
      // there's no destructive-cleanup risk to guard against like the
      // Facebook/LinkedIn status routes have.
      return NextResponse.json({ connected: false });
    }
    const data = await res.json();
    return NextResponse.json({
      connected: true,
      userId: resolved.userId,
      igUserId: ig.igUserId,
      username: data.username || ig.username || '',
      pageId: ig.pageId,
      pageName: ig.pageName,
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
