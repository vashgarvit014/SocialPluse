import { NextRequest, NextResponse } from 'next/server';
import { getFacebookAuth, getAnyFacebookAuth, getInstagramAccount } from '../../facebook/vault';
import { requireApiSession } from '@/lib/auth/api';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Instagram has no account of its own here - it's derived from whichever
// Facebook Page (of the Facebook account identified by userId, or the one
// connected account when userId isn't known yet - same self-heal pattern as
// facebook/status) has an Instagram Business account linked. Same pattern:
// computed server-side, never trusted from client cache.
export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const requestedUserId = request.nextUrl.searchParams.get('userId');
  let resolved: { userId: string; pages: Array<{ id: string; name: string; instagramAccountId?: string; instagramUsername?: string }> } | null;
  if (requestedUserId) {
    const found = getFacebookAuth(requestedUserId);
    resolved = found ? { userId: requestedUserId, pages: found.pages } : null;
  } else {
    resolved = getAnyFacebookAuth();
  }
  if (!resolved) return NextResponse.json({ connected: false });

  const ig = getInstagramAccount(resolved.userId);
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
