export interface PostMedia { id: string; url: string; type: 'image' | 'video'; name?: string; altText?: string }

// Per-platform row for a scheduled post, returned by GET /api/scheduler.
// A multi-platform post is never reduced to one status: LinkedIn can be
// PUBLISHED while Instagram is CONNECTION_REQUIRED.
export interface PlatformPostStatus {
  id: string;
  scheduledPostId: string;
  platform: string;
  platformConnectionId: string | null;
  destination: string | null;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CONNECTION_REQUIRED' | 'CANCELLED';
  attemptCount: number;
  lastAttemptAt: string | null;
  publishedAt: string | null;
  externalPostId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostSummary {
  total: number;
  published: number;
  allPublished: boolean;
  anyConnectionRequired: boolean;
  reconnectPlatforms: string[];
  failedPlatforms: string[];
  headline: string;
  detail: string;
}

// Instagram collab-post status for one collaborator. Automatic transitions
// (driven by a publish attempt) only ever reach 'Submitted'/'Ready'/'Failed'/
// 'Unknown'. 'Manual Action Required'/'Pending Acceptance' are set only by an
// explicit user click, and 'Accepted'/'Declined' only by an explicit,
// self-reported "mark as" action — Instagram's API exposes no way to confirm
// a collaborator actually accepted, so this app must never infer it.
export type CollabStatus =
  | 'Not Requested' | 'Ready' | 'Submitted' | 'Manual Action Required'
  | 'Pending Acceptance' | 'Accepted' | 'Declined' | 'Failed' | 'Unknown';

export interface Collaborator {
  username: string; // normalized, no leading @
  type: 'professional' | 'private';
  status: CollabStatus;
  lastUpdatedAt?: string; // ISO, set on every status transition
  note?: string; // last error/status detail, shown in the badge tooltip
}

export interface PostRecord {
  id: string; content: string; imageUrl: string; videoUrl?: string; mediaUrl?: string;
  mediaType?: 'image' | 'video' | null; mediaUrls?: string[]; mediaList?: PostMedia[];
  isCarousel?: boolean; platforms: string[];
  accounts: Array<{ platform: string; accessToken?: string; userId?: string; pageId?: string }>;
  scheduledAt: string | null; status: string; createdAt: string; updatedAt?: string; cancelledAt?: string | null;
  // Instagram Trial Reel intent: set in the studio when Instagram + a single
  // video (Reel) is selected. Saved with drafts/scheduled posts, shown as a
  // badge, and routed to the trial seam at publish time (never silently
  // posted as a normal Reel).
  trialReel?: boolean;
  // Instagram collaborators (up to 3): set in the studio alongside trialReel,
  // saved with drafts/scheduled posts, forwarded to instagram/publish at
  // publish time (normal + trial Reels). Replaces the legacy single-string
  // `collaborator` field — see normalizeLegacyCollaborator() for reading old
  // records that still only have that field.
  collaborators?: Collaborator[];
  /** @deprecated use `collaborators` — kept only so old saved payloads still type-check */
  collaborator?: string;
  // Permalink for the published Instagram post, fetched best-effort only
  // when a private collaborator needs the "Open Instagram" deep link. Unset
  // when there's nothing to link to, or when the lookup itself failed.
  instagramPostUrl?: string;
  // Last time this post was scheduled for, preserved through cancellation so
  // the Drafts view can still show/sort by "was going out at 5:00 AM" etc.
  previousScheduledAt?: string | null;
  source?: string; editorState?: Record<string, unknown>;
  platformContent?: Record<string, { caption: string; hashtags: string[] }>;
  // Derived server-side from platformStatuses on every read (never stored),
  // so it can never disagree with the rows behind it.
  platformStatuses?: PlatformPostStatus[];
  overallStatus?: string;
  summary?: PostSummary;
  [key: string]: unknown;
}
// Reads either shape a saved PostRecord may have: the current `collaborators`
// array, or a pre-migration `collaborator` string (comma/space-separated
// usernames, no type/status — always treated as 'professional', since that's
// what the old single-string path always sent to Graph as a real
// `collaborators` param).
export function normalizeLegacyCollaborator(post: Pick<PostRecord, 'collaborator' | 'collaborators'>): Collaborator[] | undefined {
  if (post.collaborators && post.collaborators.length) return post.collaborators;
  const raw = post.collaborator;
  if (!raw || typeof raw !== 'string') return undefined;
  const usernames = raw.split(/[,\s]+/).map(c => c.trim().replace(/^@+/, '')).filter(Boolean).slice(0, 3);
  if (!usernames.length) return undefined;
  return usernames.map(username => ({ username, type: 'professional' as const, status: 'Not Requested' as const }));
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
