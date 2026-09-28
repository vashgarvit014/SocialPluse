import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { moveFailedPostToDraft } from '@/lib/publishing-monitor';
import { logAuthEvent } from '@/lib/auth/audit';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  try {
    const post = moveFailedPostToDraft(id);
    logAuthEvent('PUBLISH_MOVED_TO_DRAFT', { meta: { postId: id, actorUserId: session.userId } });
    return NextResponse.json({ success: true, post: { id: post.id, status: post.status } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not move to draft' }, { status: 409 });
  }
}
