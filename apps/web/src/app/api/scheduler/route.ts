import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { deleteUserPost, getUserPost, listUserPosts, updateUserPost, upsertUserPost } from '@/lib/post-store';
import { cancelPost, reschedulePost, type PostRecord } from '@/lib/posts';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

// Every handler here is scoped to session.userId and nothing else. The post id
// is only ever resolved together with the owner, so a guessed id from another
// user reads as "not found" rather than as someone else's post.
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const posts = await listUserPosts(session.userId);
    return NextResponse.json({ posts: posts.map(p => ({ ...p, accounts: (p.accounts || []).map(({ accessToken: _token, ...a }) => { void _token; return a; }) })) });
  } catch { return NextResponse.json({ error: 'Unable to read post storage; no data changed.' }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const body = await request.json();
    const draft = body.status === 'draft';
    if (typeof body.content !== 'string' || !Array.isArray(body.platforms) || (!draft && (!body.content.trim() || !body.platforms.length))) return NextResponse.json({ error: 'Missing content or platforms' }, { status: 400 });
    if (!draft && (!body.scheduledAt || !Number.isFinite(Date.parse(body.scheduledAt)) || Date.parse(body.scheduledAt) <= Date.now() + 300000)) return NextResponse.json({ error: 'Schedule time must be at least 5 minutes from now' }, { status: 400 });
    // Owner-scoped lookup: a body.id belonging to another user resolves to
    // `undefined`, which falls through to the "missing or no longer editable"
    // branch below rather than mutating their post.
    const existing = body.id ? await getUserPost(session.userId, body.id) : undefined;
    if (body.id && (!existing || !['draft', 'cancelled', 'pending', 'scheduled'].includes(existing.status))) return NextResponse.json({ error: 'Post is missing or no longer editable' }, { status: 409 });
    const now = new Date().toISOString();
    const base = draft && existing && ['pending', 'scheduled', 'cancelled'].includes(existing.status) ? cancelPost(existing, now) : existing;
    const post: PostRecord = {
      ...base, ...body, id: existing?.id || randomUUID(), imageUrl: body.imageUrl || '',
      accounts: (body.accounts || []).map((a: PostRecord['accounts'][number]) => ({ platform: a.platform, userId: a.userId, pageId: a.pageId })),
      status: draft ? 'draft' : 'pending', scheduledAt: draft ? null : body.scheduledAt,
      createdAt: existing?.createdAt || now, updatedAt: now, source: base?.source || body.source || 'Manual Draft',
      cancelledAt: base?.cancelledAt || null,
    };
    const saved = await upsertUserPost(session.userId, post);
    return NextResponse.json({ success: true, post: saved });
  } catch { return NextResponse.json({ error: 'Unable to save post; existing storage was not replaced with empty data.' }, { status: 500 }); }
}
// Reschedule: updates scheduledAt on the SAME post/job — never creates a new
// one. Only a still-pending post can move; the status check inside
// reschedulePost also blocks a reschedule that loses a race with the
// publish worker (which claims the post by flipping it to "publishing"
// before its first network call).
export async function PATCH(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { id, scheduledAt } = await request.json();
    if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
    if (typeof scheduledAt !== 'string' || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now() + 300000) {
      return NextResponse.json({ error: 'Schedule time must be at least 5 minutes from now' }, { status: 400 });
    }
    const post = await updateUserPost(session.userId, id, current => reschedulePost(current, scheduledAt));
    return NextResponse.json({ success: true, post });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Reschedule failed' }, { status: 409 }); }
}
// Existing DELETE clients cancel. Permanent deletion requires an explicit action.
export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { id, action } = await request.json();
    if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
    if (action === 'delete-draft') {
      const post = await getUserPost(session.userId, id);
      if (!post || !['draft', 'cancelled'].includes(post.status)) return NextResponse.json({ error: 'Only drafts may be deleted' }, { status: 409 });
      await deleteUserPost(session.userId, id);
      logSystem({ level: 'INFO', category: 'PUBLISHING', event: 'DRAFT_DELETED', userId: session.userId, resourceId: id, message: 'Draft deleted' });
      return NextResponse.json({ success: true });
    }
    const post = await updateUserPost(session.userId, id, p => cancelPost(p));
    return NextResponse.json({ success: true, post });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Cancellation failed' }, { status: 409 }); }
}
