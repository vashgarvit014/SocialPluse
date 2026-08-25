import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_FILE = join(process.cwd(), 'scheduled-posts.json');

interface ScheduledPost {
  id: string;
  content: string;
  imageUrl: string;
  platforms: string[];
  accounts: Array<{ platform: string; accessToken: string; userId: string }>;
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

async function publishPost(post: ScheduledPost, platform: string, account: { accessToken: string; userId: string }) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/${platform}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: post.content,
      imageUrl: post.imageUrl,
      accessToken: account.accessToken,
      userId: account.userId,
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
