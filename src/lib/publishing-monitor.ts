import 'server-only';
import { loadPosts, updatePost } from '@/lib/post-store';
import type { PostRecord } from '@/lib/posts';

// Global, not per-user: scheduled-posts.json has no userId field at all
// (SocialPulse is single-tenant for content the same way it is for
// platform connections — see connections.ts) — every post belongs to the
// tool, not to a specific account. A "user" column here would be fabricated.
export interface PublishingItem {
  id: string;
  contentPreview: string;
  platforms: string[];
  failedPlatforms: string[] | null;
  status: string;
  scheduledAt: string | null;
  updatedAt: string | null;
}

function toItem(p: PostRecord): PublishingItem {
  return {
    id: p.id,
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

export function getPublishingCounts(): PublishingCounts {
  const posts = loadPosts();
  return {
    scheduled: posts.filter(p => p.status === 'pending' || p.status === 'scheduled').length,
    published: posts.filter(p => p.status === 'published').length,
    failed: posts.filter(p => p.status === 'failed').length,
    draft: posts.filter(p => p.status === 'draft').length,
  };
}

export function listPublishing(params: { status?: 'scheduled' | 'published' | 'failed'; platform?: string; limit: number }): PublishingItem[] {
  let posts = loadPosts();
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
export function retryFailedPost(id: string): PostRecord {
  return updatePost(id, (post) => {
    if (post.status !== 'failed') throw new Error('Only a failed post can be retried.');
    const now = new Date().toISOString();
    return { ...post, status: 'pending', scheduledAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), failedPlatforms: undefined, updatedAt: now };
  });
}

export function moveFailedPostToDraft(id: string): PostRecord {
  return updatePost(id, (post) => {
    if (post.status !== 'failed') throw new Error('Only a failed post can be moved to draft.');
    const now = new Date().toISOString();
    return { ...post, status: 'draft', scheduledAt: null, failedPlatforms: undefined, previousScheduledAt: post.scheduledAt || post.previousScheduledAt || null, updatedAt: now };
  });
}
