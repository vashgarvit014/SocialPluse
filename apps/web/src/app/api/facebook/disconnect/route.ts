import { NextRequest, NextResponse } from 'next/server';
import { deleteFacebookAuth } from '../vault';
import { requireApiSession } from '@/lib/auth/api';
import { scrubUserPostAccounts } from '@/lib/post-store';
import { logSystem } from '@/lib/system-log';

// POST /api/facebook/disconnect
// Removes server-held credentials so a disconnected Page can never publish again:
//   - deletes THIS user's Facebook connection (user + Page tokens)
//   - scrubs credential copies out of THIS user's scheduled posts
//
// The provider userId in the body only narrows the scrub within the caller's
// own posts. It no longer selects which stored credentials get deleted — that
// was the bug: any authenticated user could pass someone else's id and
// disconnect them, and omitting it entirely wiped the whole vault
// system-wide. The old implementation also rewrote the entire global
// scheduled-posts.json as a side effect.
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const platform = body.platform;
    const providerUserId = typeof body.userId === 'string' && body.userId ? body.userId : null;

    if (platform !== 'facebook') {
      return NextResponse.json(
        { success: false, code: 'UNSUPPORTED_PLATFORM', message: 'Only Facebook disconnect is supported.' },
        { status: 400 },
      );
    }

    await deleteFacebookAuth(session.userId);

    const scrubbedPosts = await scrubUserPostAccounts(session.userId, 'facebook', providerUserId);

    logSystem({ level: 'INFO', category: 'PLATFORM', event: 'FACEBOOK_DISCONNECTED', userId: session.userId, platform: 'facebook', message: 'Facebook disconnected' });
    return NextResponse.json({ success: true, scrubbedPosts });
  } catch (error) {
    console.error('[facebook/disconnect] error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, code: 'DISCONNECT_FAILED', message: 'Failed to disconnect Facebook.' },
      { status: 500 },
    );
  }
}