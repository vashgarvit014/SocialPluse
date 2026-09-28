import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { loadPosts, savePosts, updatePost } from '@/lib/post-store';
import { cancelPost, reschedulePost, type PostRecord } from '@/lib/posts';
import { requireApiSession } from '@/lib/auth/api';

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    return NextResponse.json({ posts: loadPosts().map(p => ({ ...p, accounts: (p.accounts || []).map(({ accessToken: _token, ...a }) => { void _token; return a; }) })) });
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
    const posts = loadPosts();
    const existing = body.id ? posts.find(p => p.id === body.id) : undefined;
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
    if (existing) posts[posts.indexOf(existing)] = post; else posts.push(post);
    savePosts(posts); return NextResponse.json({ success: true, post });
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
    const post = updatePost(id, current => reschedulePost(current, scheduledAt));
    return NextResponse.json({ success: true, post });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Reschedule failed' }, { status: 409 }); }
}
// Existing DELETE clients cancel. Permanent deletion requires an explicit action.
export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { id, action } = await request.json();
    if (action === 'delete-draft') {
      const posts = loadPosts(); const post = posts.find(p => p.id === id);
      if (!post || !['draft', 'cancelled'].includes(post.status)) return NextResponse.json({ error: 'Only drafts may be deleted' }, { status: 409 });
      savePosts(posts.filter(p => p.id !== id)); return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: true, post: updatePost(id, p => cancelPost(p)) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Cancellation failed' }, { status: 409 }); }
}
