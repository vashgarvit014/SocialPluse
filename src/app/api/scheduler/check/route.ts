import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_FILE = join(process.cwd(), 'scheduled-posts.json');

interface MediaItem { id: string; url: string; type: 'image' | 'video'; name?: string }
interface ScheduledPost {
  id: string;
  content: string;
  imageUrl: string;
  videoUrl?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | null;
  mediaUrls?: string[];
  mediaList?: MediaItem[];
  platforms: string[];
  accounts: Array<{ platform: string; accessToken?: string; userId?: string; pageId?: string }>;
  scheduledAt: string;
  status: 'pending' | 'published' | 'failed' | 'cancelled';
  createdAt: string;
}

function loadPosts(): ScheduledPost[] {
  if (!existsSync(DATA_FILE)) return [];
  try { return JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function savePosts(posts: ScheduledPost[]) {
  writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2));
}

async function publishPost(post: ScheduledPost, platform: string, account: { accessToken?: string; userId?: string; pageId?: string }) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const mediaList = (post as unknown as { mediaList?: MediaItem[] }).mediaList;
  const mediaUrls = (post as unknown as { mediaUrls?: string[] }).mediaUrls || mediaList?.map(m => m.url);
  const mediaUrl = (post as unknown as { mediaUrl?: string; videoUrl?: string }).mediaUrl || (post as unknown as { videoUrl?: string }).videoUrl || post.imageUrl || mediaUrls?.[0];
  const mediaType = (post as unknown as { mediaType?: string }).mediaType || ((post as unknown as { videoUrl?: string }).videoUrl ? 'video' : post.imageUrl ? 'image' : undefined) || mediaList?.[0]?.type;
  const isVideo = mediaType === 'video' || mediaList?.some(m => m.type === 'video');
  // Stable attempt id per post+platform: concurrent "check now" runs dedupe server-side.
  // Server resolves the OAuth token itself from userId; legacy stored tokens ride along as fallback.
  const res = await fetch(`${baseUrl}/api/${platform}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: post.content,
      imageUrl: !isVideo ? post.imageUrl || mediaUrl : undefined,
      videoUrl: isVideo ? (post as unknown as { videoUrl?: string }).videoUrl || mediaUrl : undefined,
      mediaUrl,
      mediaType,
      mediaUrls: mediaUrls || (mediaUrl ? [mediaUrl] : undefined),
      mediaList,
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

  for (const post of posts) {
    if (post.status !== 'pending') continue;
    const scheduledTime = new Date(post.scheduledAt);
    if (scheduledTime > now) continue;

    let allSuccess = true;
    for (const platform of post.platforms) {
      const account = post.accounts.find(a => a.platform === platform);
      if (!account) { allSuccess = false; continue; }
      try {
        const ok = await publishPost(post, platform, account);
        if (!ok) allSuccess = false;
      } catch {
        allSuccess = false;
      }
    }

    post.status = allSuccess ? 'published' : 'failed';
    publishedCount++;
  }

  savePosts(posts);

  return NextResponse.json({ publishedCount, checkedAt: now.toISOString() });
}
