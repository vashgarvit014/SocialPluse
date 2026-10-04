import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { scrubUserPostAccounts } from '@/lib/post-store';

// Internal-only bridge for integrations-service's disconnect routes: scrubs
// stored-token copies out of the disconnecting user's OWN scheduled posts.
// scheduled_posts/legacy-JSON-import logic belongs to scheduler/publishing,
// not integrations-service, so this stays here rather than being duplicated
// there (same reasoning as leaving /api/canva/export in the monolith).
// Guarded by INTERNAL_SERVICE_SECRET — never reachable from the browser.
export async function POST(request: NextRequest) {
  const provided = request.headers.get('x-internal-secret') || '';
  const expected = process.env.INTERNAL_SERVICE_SECRET || '';
  const bufA = Buffer.from(provided);
  const bufB = Buffer.from(expected);
  const authorized = expected.length > 0 && bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  if (!authorized) {
    return NextResponse.json({ error: 'INTERNAL_UNAUTHORIZED' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const platform = typeof body.platform === 'string' ? body.platform : '';
  const providerUserId = typeof body.providerUserId === 'string' ? body.providerUserId : null;
  if (!userId || !platform) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const scrubbedPosts = await scrubUserPostAccounts(userId, platform, providerUserId);
  return NextResponse.json({ scrubbedPosts });
}
