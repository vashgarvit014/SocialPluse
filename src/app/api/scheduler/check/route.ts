import { NextResponse } from 'next/server';
import { claimDuePosts, updatePostById } from '@/lib/post-store';
import type { PostRecord as ScheduledPost, PostMedia as MediaItem } from '@/lib/posts';
import { requireApiSession } from '@/lib/auth/api';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { verifyInternalActor, INTERNAL_HEADER, internalActorHeaders } from '@/lib/internal-auth';
import { logSystem } from '@/lib/system-log';

type OwnedPost = ScheduledPost & { userId: string | null };

// Publishes `post` to one platform. The credential is always resolved by the
// publish route from the POST OWNER (`post.userId`), asserted via a signed
// internal header — never from a userId carried in the post body, which is
// client-shaped data written by an earlier, unscoped version of this app.
async function publishPost(post: OwnedPost, platform: string, account: { accessToken?: string; userId?: string; pageId?: string }) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  if (!post.userId) {
    // Legacy row imported from scheduled-posts.json with no provable owner.
    // Publishing on its behalf would use an unknown account; leave it for a
    // human to re-claim from Superadmin.
    logSystem({ level: 'WARN', category: 'PUBLISHING', event: 'POST_PUBLISH_SKIPPED_UNOWNED', resourceId: post.id, message: 'Scheduled post has no owner; cannot resolve credentials to publish it' });
    return false;
  }
  const mediaList = (post as unknown as { mediaList?: MediaItem[] }).mediaList;
  const mediaUrls = (post as unknown as { mediaUrls?: string[] }).mediaUrls || mediaList?.map(m => m.url);
  const mediaUrl = (post as unknown as { mediaUrl?: string; videoUrl?: string }).mediaUrl || (post as unknown as { videoUrl?: string }).videoUrl || post.imageUrl || mediaUrls?.[0];
  const mediaType = (post as unknown as { mediaType?: string }).mediaType || ((post as unknown as { videoUrl?: string }).videoUrl ? 'video' : post.imageUrl ? 'image' : undefined) || mediaList?.[0]?.type;
  const isVideo = mediaType === 'video' || mediaList?.some(m => m.type === 'video');
  // Stable attempt id per post+platform: concurrent "check now" runs dedupe server-side.
  // Server resolves the OAuth token itself from the owning userId.
  const isWhapp = platform === 'whatsapp';
  // PERMANENT RULE: WhatsApp posts never contain hashtags — strip every
  // #tag anywhere (trailing-only stripping lets inline tags leak through).
  const stripAllHashtags = (s: string) => s.replace(/#[A-Za-z0-9_]+/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const res = await fetch(`${baseUrl}/api/${platform}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internalActorHeaders(post.userId) },
    body: JSON.stringify({
      content: post.platformContent?.[platform] ? (isWhapp ? stripAllHashtags(post.platformContent[platform].caption) : [post.platformContent[platform].caption, post.platformContent[platform].hashtags.map(t => '#' + t.replace(/^#+/, '')).join(' ')].filter(Boolean).join('\n\n')) : (isWhapp ? stripAllHashtags(post.content) : post.content),
      imageUrl: !isVideo ? post.imageUrl || mediaUrl : undefined,
      videoUrl: isVideo ? (post as unknown as { videoUrl?: string }).videoUrl || mediaUrl : undefined,
      mediaUrl,
      mediaType,
      mediaUrls: mediaUrls || (mediaUrl ? [mediaUrl] : undefined),
      mediaList,
      isCarousel: (post as unknown as { isCarousel?: boolean }).isCarousel === true || undefined,
      trialReel: (post as unknown as { trialReel?: boolean }).trialReel === true ? true : undefined,
      collaborator: (post as unknown as { collaborator?: string }).collaborator
        || (post.editorState as unknown as { collaborator?: string } | undefined)?.collaborator
        || undefined,
      userId: account.userId,
      pageId: account.pageId,
      attemptId: `sched:${post.id}:${platform}`,
    }),
  });
  return res.ok;
}

// This endpoint drains EVERY user's queue — one shared worker, one shared
// trigger. Leaving it on plain requireApiSession() meant any authenticated
// non-admin could fire a global publish run at will (not a data leak: each
// post still publishes under its own owner's credentials, but it is an
// unprivileged cross-user trigger and a cheap DoS/abuse surface).
//
// Allowed callers, both deliberate:
//   - a Superadmin (manual "run the scheduler now")
//   - an external cron holding a signed internal assertion
export async function POST(request: Request) {
  const internal = verifyInternalActor(request.headers.get(INTERNAL_HEADER));
  if (!internal) {
    const admin = await requireApiSuperadmin();
    if (admin instanceof NextResponse) return admin;
  }
  // One shared worker drains every user's queue; each post still carries its
  // own owner and publishes with that owner's credentials (see publishPost).
  const posts = await claimDuePosts(new Date());
  const now = new Date();
  let publishedCount = 0;

  for (const candidate of posts) {
    let post = candidate;
    // Claim before the first network await. A concurrent check/cancel cannot
    // overwrite this in-flight post. Interrupted claims require manual review.
    try { post = await updatePostById(post.id, current => {
      if (current.status !== 'pending' || !current.scheduledAt || Date.parse(current.scheduledAt) > now.getTime()) throw new Error('Already claimed, rescheduled or cancelled');
      return { ...current, status: 'publishing', updatedAt: new Date().toISOString() };
    }); } catch { continue; }
    const owned: OwnedPost = { ...post, userId: candidate.userId };

    let successCount = 0;
    const failedPlatforms: string[] = [];
    for (const platform of post.platforms) {
      const account = post.accounts.find(a => a.platform === platform);
      if (!account) { failedPlatforms.push(platform); continue; }
      try {
        const ok = await publishPost(owned, platform, account);
        if (ok) {
          successCount++;
          logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: owned.userId ?? undefined, platform, resourceId: post.id, message: `Scheduled post published to ${platform}`, requestId: `sched:${post.id}:${platform}` });
        } else {
          failedPlatforms.push(platform);
          logSystem({ level: 'ERROR', category: 'PUBLISHING', event: 'POST_PUBLISH_FAILED', userId: owned.userId ?? undefined, platform, resourceId: post.id, message: `Scheduled post failed on ${platform}`, requestId: `sched:${post.id}:${platform}` });
        }
      } catch {
        failedPlatforms.push(platform);
        logSystem({ level: 'ERROR', category: 'PUBLISHING', event: 'POST_PUBLISH_FAILED', userId: owned.userId ?? undefined, platform, resourceId: post.id, message: `Scheduled post errored on ${platform}`, requestId: `sched:${post.id}:${platform}` });
      }
    }
    const anySuccess = successCount > 0;
    // Mark as published if at least one platform delivered (e.g. WhatsApp succeeded but Instagram failed).
    // Keep failedPlatforms for debugging; FAILED only if nothing delivered.
    await updatePostById(post.id, current => ({ ...current, status: anySuccess ? 'published' : 'failed', failedPlatforms: failedPlatforms.length ? failedPlatforms : undefined, updatedAt: new Date().toISOString() } as unknown as ScheduledPost));
    if (anySuccess) publishedCount++;
  }


  return NextResponse.json({ publishedCount, checkedAt: now.toISOString() });
}
