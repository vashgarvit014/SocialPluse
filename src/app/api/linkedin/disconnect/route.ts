import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { deleteLinkedInToken } from '../vault';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

const POSTS_FILE = join(process.cwd(), 'scheduled-posts.json');

interface StoredAccount {
  platform?: string;
  accessToken?: string;
  userId?: string;
  [key: string]: unknown;
}

interface StoredPost {
  accounts?: StoredAccount[];
  [key: string]: unknown;
}

// POST /api/linkedin/disconnect { platform, userId? }
// Removes server-held credentials so a disconnected account can never publish again:
// - deletes the OAuth token from the server vault
// - scrubs accessToken/userId copies stored inside scheduled posts
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { platform, userId } = await request.json();

    if (platform !== 'linkedin') {
      return NextResponse.json(
        { success: false, code: 'UNSUPPORTED_PLATFORM', message: 'Only LinkedIn disconnect is supported.' },
        { status: 400 }
      );
    }

    deleteLinkedInToken(userId);

    let scrubbedPosts = 0;
    if (existsSync(POSTS_FILE)) {
      try {
        const posts = JSON.parse(readFileSync(POSTS_FILE, 'utf8')) as StoredPost[];
        for (const post of posts) {
          if (!Array.isArray(post.accounts)) continue;
          let changed = false;
          for (const account of post.accounts) {
            if (account.platform !== 'linkedin') continue;
            if (userId && account.userId && account.userId !== userId) continue;
            if ('accessToken' in account || 'userId' in account) {
              delete account.accessToken;
              delete account.userId;
              changed = true;
            }
          }
          if (changed) scrubbedPosts++;
        }
        writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
      } catch (err) {
        console.error('[linkedin/disconnect] failed to scrub scheduled posts:', err instanceof Error ? err.message : err);
      }
    }

    logSystem({ level: 'INFO', category: 'PLATFORM', event: 'LINKEDIN_DISCONNECTED', userId: session.userId, platform: 'linkedin', message: 'LinkedIn disconnected' });
    return NextResponse.json({ success: true, scrubbedPosts });
  } catch (error) {
    console.error('[linkedin/disconnect] error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, code: 'DISCONNECT_FAILED', message: 'Failed to disconnect LinkedIn.' },
      { status: 500 }
    );
  }
}
