import { NextResponse } from 'next/server';
import { loadPosts, updatePost } from '@/lib/post-store';
import type { PostRecord as ScheduledPost, PostMedia as MediaItem } from '@/lib/posts';

async function publishPost(post: ScheduledPost, platform: string, account: { accessToken?: string; userId?: string; pageId?: string }) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const mediaList = (post as unknown as { mediaList?: MediaItem[] }).mediaList;
  const mediaUrls = (post as unknown as { mediaUrls?: string[] }).mediaUrls || mediaList?.map(m => m.url);
  const mediaUrl = (post as unknown as { mediaUrl?: string; videoUrl?: string }).mediaUrl || (post as unknown as { videoUrl?: string }).videoUrl || post.imageUrl || mediaUrls?.[0];
  const mediaType = (post as unknown as { mediaType?: string }).mediaType || ((post as unknown as { videoUrl?: string }).videoUrl ? 'video' : post.imageUrl ? 'image' : undefined) || mediaList?.[0]?.type;
  const isVideo = mediaType === 'video' || mediaList?.some(m => m.type === 'video');
  // Stable attempt id per post+platform: concurrent "check now" runs dedupe server-side.
  // Server resolves the OAuth token itself from userId; legacy stored tokens ride along as fallback.
  const isWhapp = platform === 'whatsapp';
  // PERMANENT RULE: WhatsApp posts never contain hashtags — strip every
  // #tag anywhere (trailing-only stripping lets inline tags leak through).
  const stripAllHashtags = (s: string) => s.replace(/#[A-Za-z0-9_]+/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const res = await fetch(`${baseUrl}/api/${platform}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      accessToken: account.accessToken,
      userId: account.userId,
      pageId: account.pageId,
      attemptId: `sched:${post.id}:${platform}`,
    }),
  });
  return res.ok;
}

export async function POST() {
  const posts = loadPosts();
  const now = new Date();
  let publishedCount = 0;

  for (const candidate of posts) {
    let post = candidate;
    if (post.status !== 'pending') continue;
    const scheduledTime = new Date(post.scheduledAt || '');
    if (!Number.isFinite(scheduledTime.getTime()) || scheduledTime > now) continue;
    // Claim before the first network await. A concurrent check/cancel cannot
    // overwrite this in-flight post. Interrupted claims require manual review.
    try { post = updatePost(post.id, current => {
      if (current.status !== 'pending' || !current.scheduledAt || Date.parse(current.scheduledAt) > now.getTime()) throw new Error('Already claimed, rescheduled or cancelled');
      return { ...current, status: 'publishing', updatedAt: new Date().toISOString() };
    }); } catch { continue; }

    let successCount = 0;
    const failedPlatforms: string[] = [];
    for (const platform of post.platforms) {
      const account = post.accounts.find(a => a.platform === platform);
      if (!account) { failedPlatforms.push(platform); continue; }
      try {
        const ok = await publishPost(post, platform, account);
        if (ok) successCount++;
        else failedPlatforms.push(platform);
      } catch {
        failedPlatforms.push(platform);
      }
    }
    const allSuccess = successCount === post.platforms.length;
    const anySuccess = successCount > 0;
    // Mark as published if at least one platform delivered (e.g. WhatsApp succeeded but Instagram failed).
    // Keep failedPlatforms for debugging; FAILED only if nothing delivered.
    updatePost(post.id, current => ({ ...current, status: anySuccess ? 'published' : 'failed', failedPlatforms: failedPlatforms.length ? failedPlatforms : undefined, updatedAt: new Date().toISOString() } as unknown as ScheduledPost));
    if (anySuccess) publishedCount++;
  }


  return NextResponse.json({ publishedCount, checkedAt: now.toISOString() });
}
