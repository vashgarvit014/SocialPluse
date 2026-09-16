import { NextResponse } from 'next/server';

// There is no separate Instagram login here. A publishable Instagram account
// is a Business/Creator account linked to a Facebook Page, and it publishes
// using that Page's own access token - so "connecting Instagram" just means
// running (or re-running) the Facebook OAuth flow, which now also requests
// instagram_basic + instagram_content_publish. Re-running it is safe even if
// Facebook is already connected: it's how an existing connection picks up
// the new Instagram scopes without a separate re-auth path to maintain.
//
// (This route previously implemented Instagram's Basic Display API, which
// Meta shut down in December 2024 and which was read-only even when it
// existed - it could never have published anything.)
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/callback';
const APP_ORIGIN = new URL(FACEBOOK_REDIRECT_URI).origin;

export async function GET() {
  return NextResponse.redirect(new URL('/api/facebook/auth', APP_ORIGIN));
}
