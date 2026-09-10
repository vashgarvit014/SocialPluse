import { NextRequest, NextResponse } from 'next/server';
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

export async function GET() {
  const posts = loadPosts();
  return NextResponse.json({ posts });
}

export async function POST(request: NextRequest) {
  const { content, imageUrl, videoUrl, mediaUrl, mediaType, mediaUrls, mediaList, platforms, accounts, scheduledAt } = await request.json();

  if (!content || !platforms?.length || !scheduledAt) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const scheduledTime = new Date(scheduledAt);
  const minTime = new Date(Date.now() + 5 * 60 * 1000);
  if (scheduledTime <= minTime) {
    return NextResponse.json({ error: 'Schedule time must be at least 5 minutes from now' }, { status: 400 });
  }

  const posts = loadPosts();
  // Backward compat: keep imageUrl, add video/media fields + multi
  const resolvedMediaType: 'image' | 'video' | null = mediaType || (videoUrl ? 'video' : imageUrl ? 'image' : null);
  const resolvedMediaUrl = mediaUrl || videoUrl || imageUrl || '';
  const resolvedVideoUrl = videoUrl || (resolvedMediaType === 'video' ? resolvedMediaUrl : '');
  const resolvedImageUrl = imageUrl || (resolvedMediaType === 'image' ? resolvedMediaUrl : '');
  const resolvedMediaUrls: string[] | undefined = mediaUrls || (mediaList as MediaItem[] | undefined)?.map(m => m.url) || (resolvedMediaUrl ? [resolvedMediaUrl] : undefined);
  const resolvedMediaList: MediaItem[] | undefined = mediaList || resolvedMediaUrls?.map((url, idx) => ({ id: `m${idx}`, url, type: url.startsWith('data:video/') ? 'video' as const : 'image' as const }));
  const newPost: ScheduledPost = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    content,
    imageUrl: resolvedImageUrl || '',
    videoUrl: resolvedVideoUrl || undefined,
    mediaUrl: resolvedMediaUrl || undefined,
    mediaType: resolvedMediaType,
    mediaUrls: resolvedMediaUrls,
    mediaList: resolvedMediaList,
    platforms,
    accounts: accounts || [],
    scheduledAt,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  posts.push(newPost);
  savePosts(posts);

  return NextResponse.json({ success: true, post: newPost });
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
  }

  const posts = loadPosts();
  const updated = posts.map(p => p.id === id ? { ...p, status: 'cancelled' as const } : p);
  savePosts(updated);

  return NextResponse.json({ success: true });
}
