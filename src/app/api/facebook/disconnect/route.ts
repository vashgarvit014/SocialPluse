import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { deleteFacebookAuth } from '../vault';

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

// POST /api/facebook/disconnect { platform, userId? }
// Removes server-held credentials so a disconnected Page can never publish
// again: deletes the user token + Page tokens from the vault and scrubs
// credential copies stored inside scheduled posts.
export async function POST(request: NextRequest) {
  try {
    const { platform, userId } = await request.json();

    if (platform !== 'facebook') {
      return NextResponse.json(
        { success: false, code: 'UNSUPPORTED_PLATFORM', message: 'Only Facebook disconnect is supported.' },
        { status: 400 }
      );
    }

    deleteFacebookAuth(userId);

    let scrubbedPosts = 0;
    if (existsSync(POSTS_FILE)) {
      try {
        const posts = JSON.parse(readFileSync(POSTS_FILE, 'utf8')) as StoredPost[];
        for (const post of posts) {
          if (!Array.isArray(post.accounts)) continue;
          let changed = false;
          for (const account of post.accounts) {
            if (account.platform !== 'facebook') continue;
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
        console.error('[facebook/disconnect] failed to scrub scheduled posts:', err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({ success: true, scrubbedPosts });
  } catch (error) {
    console.error('[facebook/disconnect] error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, code: 'DISCONNECT_FAILED', message: 'Failed to disconnect Facebook.' },
      { status: 500 }
    );
  }
}
