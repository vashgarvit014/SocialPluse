import { NextRequest, NextResponse } from 'next/server';
import { deleteLinkedInToken } from '../vault';
import { requireApiSession } from '@/lib/auth/api';
import { scrubUserPostAccounts } from '@/lib/post-store';
import { logSystem } from '@/lib/system-log';

// POST /api/linkedin/disconnect
// Removes server-held credentials so a disconnected account can never publish again:
//   - deletes THIS user's LinkedIn connection
//   - scrubs credential copies out of THIS user's scheduled posts
//
// The provider userId in the body is used only to narrow the scrub within the
// caller's own posts. It no longer selects which stored token gets deleted —
// that was the bug: any authenticated user could pass someone else's id and
// disconnect them, and omitting it entirely wiped the whole vault system-wide.
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const platform = body.platform;
    const providerUserId = typeof body.userId === 'string' && body.userId ? body.userId : null;

    if (platform !== 'linkedin') {
      return NextResponse.json(
        { success: false, code: 'UNSUPPORTED_PLATFORM', message: 'Only LinkedIn disconnect is supported.' },
        { status: 400 },
      );
    }

    const removed = await deleteLinkedInToken(session.userId);

    const scrubbedPosts = await scrubUserPostAccounts(session.userId, 'linkedin', providerUserId);

    logSystem({ level: 'INFO', category: 'PLATFORM', event: 'LINKEDIN_DISCONNECTED', userId: session.userId, platform: 'linkedin', message: removed ? 'LinkedIn disconnected' : 'No LinkedIn connection to disconnect' });
    return NextResponse.json({ success: true, disconnected: removed, scrubbedPosts });
  } catch (error) {
    console.error('[linkedin/disconnect] error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, code: 'DISCONNECT_FAILED', message: 'Failed to disconnect LinkedIn.' },
      { status: 500 },
    );
  }
}