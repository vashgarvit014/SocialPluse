import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { retryFailedPost } from '@/lib/publishing-monitor';
import { logAuthEvent } from '@/lib/auth/audit';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  try {
    const post = retryFailedPost(id);
    logAuthEvent('PUBLISH_RETRIED', { meta: { postId: id, actorUserId: session.userId } });
    return NextResponse.json({ success: true, post: { id: post.id, status: post.status, scheduledAt: post.scheduledAt } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Retry failed' }, { status: 409 });
  }
}
