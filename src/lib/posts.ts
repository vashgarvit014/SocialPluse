export interface PostMedia { id: string; url: string; type: 'image' | 'video'; name?: string; altText?: string }
export interface PostRecord {
  id: string; content: string; imageUrl: string; videoUrl?: string; mediaUrl?: string;
  mediaType?: 'image' | 'video' | null; mediaUrls?: string[]; mediaList?: PostMedia[];
  isCarousel?: boolean; platforms: string[];
  accounts: Array<{ platform: string; accessToken?: string; userId?: string; pageId?: string }>;
  scheduledAt: string | null; status: string; createdAt: string; updatedAt?: string; cancelledAt?: string | null;
  // Last time this post was scheduled for, preserved through cancellation so
  // the Drafts view can still show/sort by "was going out at 5:00 AM" etc.
  previousScheduledAt?: string | null;
  source?: string; editorState?: Record<string, unknown>;
  platformContent?: Record<string, { caption: string; hashtags: string[] }>;
  [key: string]: unknown;
}
export function cancelPost(post: PostRecord, now = new Date().toISOString()): PostRecord {
  if (!['pending', 'scheduled', 'cancelled'].includes(post.status)) throw new Error('This post cannot be cancelled. It may already be publishing.');
  return {
    ...post, status: 'draft', scheduledAt: null, cancelledAt: now, updatedAt: now, source: 'Schedule Cancelled',
    previousScheduledAt: post.scheduledAt || post.previousScheduledAt || null,
  };
}
// Only a still-pending post has an active job to move; anything else (already
// publishing/published/failed/draft) must go through cancel+reschedule instead.
export function reschedulePost(post: PostRecord, scheduledAt: string, now = new Date().toISOString()): PostRecord {
  if (post.status !== 'pending') throw new Error('This post cannot be rescheduled. It may already be publishing.');
  return { ...post, scheduledAt, updatedAt: now };
}
export function newestDrafts(posts: PostRecord[]) {
  return posts.filter(p => p.status === 'draft' || p.status === 'cancelled')
    .sort((a, b) => {
      const at = a.previousScheduledAt || '';
      const bt = b.previousScheduledAt || '';
      if (at !== bt) return bt.localeCompare(at);
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
}
export function postMedia(post: Pick<PostRecord, 'mediaList' | 'mediaUrls' | 'videoUrl' | 'imageUrl'>): PostMedia[] {
  if (post.mediaList?.length) return post.mediaList;
  return (post.mediaUrls?.length ? post.mediaUrls : [post.videoUrl || post.imageUrl || ''].filter(Boolean))
    .map((url, i) => ({ id: `legacy-${i}`, url, type: url === post.videoUrl || url.startsWith('data:video/') ? 'video' : 'image' }));
}
