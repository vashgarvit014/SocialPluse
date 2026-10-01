import 'server-only';
import { listAllPosts, updatePostById } from '@/lib/post-store';
import type { PostRecord } from '@/lib/posts';

// Cross-user BY DESIGN: this module backs the Superadmin publishing console,
// which is the one surface allowed to see every user's post at once. Each
// route that calls it is gated by requireApiSuperadmin(). Regular users never
// reach this code — they go through listUserPosts() in post-store.ts, which
// filters on their own user id.
export interface PublishingItem {
  id: string;
  // Null for rows imported from the pre-ownership scheduled-posts.json: those
  // have no provable owner. Surfaced as "Legacy / unassigned" in the UI rather
  // than being silently attributed to somebody.
  userId: string | null;
  contentPreview: string;
  platforms: string[];
  failedPlatforms: string[] | null;
  status: string;
  scheduledAt: string | null;
  updatedAt: string | null;
}

function toItem(p: PostRecord & { userId: string | null }): PublishingItem {
  return {
    id: p.id,
    userId: p.userId,
    contentPreview: (p.content || '').split('\n')[0].slice(0, 120),
    platforms: p.platforms || [],
    failedPlatforms: (p.failedPlatforms as string[] | undefined) || null,
    status: p.status,
    scheduledAt: p.scheduledAt,
    updatedAt: p.updatedAt || null,
  };
}

export interface PublishingCounts {
  scheduled: number;
  published: number;
  failed: number;
  draft: number;
}

export async function getPublishingCounts(): Promise<PublishingCounts> {
  const posts = await listAllPosts();
  return {
    scheduled: posts.filter(p => p.status === 'pending' || p.status === 'scheduled').length,
    published: posts.filter(p => p.status === 'published').length,
    failed: posts.filter(p => p.status === 'failed').length,
    draft: posts.filter(p => p.status === 'draft').length,
  };
}

export async function listPublishing(params: { status?: 'scheduled' | 'published' | 'failed'; platform?: string; limit: number }): Promise<PublishingItem[]> {
  let posts = (await listAllPosts()) as (PostRecord & { userId: string | null })[];
  if (params.status === 'scheduled') posts = posts.filter(p => p.status === 'pending' || p.status === 'scheduled');
  else if (params.status) posts = posts.filter(p => p.status === params.status);
  if (params.platform) posts = posts.filter(p => (p.platforms || []).includes(params.platform!));
  return posts
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))
    .slice(0, params.limit)
    .map(toItem);
}

// Only a FAILED post may be retried or drafted from this screen — reusing
// lib/posts.ts#reschedulePost/cancelPost isn't possible here, since both
// are deliberately scoped to the user-facing pending/scheduled flow and
// reject a 'failed' status (see their own guards). These are narrow,
// Superadmin-only transitions instead.
export async function retryFailedPost(id: string): Promise<PostRecord & { userId: string | null }> {
  return updatePostById(id, (post) => {
    if (post.status !== 'failed') throw new Error('Only a failed post can be retried.');
    const now = new Date().toISOString();
    return { ...post, status: 'pending', scheduledAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), failedPlatforms: undefined, updatedAt: now };
  });
}

export async function moveFailedPostToDraft(id: string): Promise<PostRecord & { userId: string | null }> {
  return updatePostById(id, (post) => {
    if (post.status !== 'failed') throw new Error('Only a failed post can be moved to draft.');
    const now = new Date().toISOString();
    return { ...post, status: 'draft', scheduledAt: null, failedPlatforms: undefined, previousScheduledAt: post.scheduledAt || post.previousScheduledAt || null, updatedAt: now };
  });
}
