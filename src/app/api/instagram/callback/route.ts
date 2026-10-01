import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';

// Dead route, kept only so an old bookmark/redirect doesn't 404 outright.
// Instagram no longer has its own OAuth callback - see instagram/auth for
// why (it rides on facebook/callback now, which is where the linked
// Instagram Business account is actually resolved and stored).
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/facebook/callback';
const APP_ORIGIN = new URL(FACEBOOK_REDIRECT_URI).origin;

// Both hops require a session: this route starts an OAuth flow, and the
// redirect target (facebook/auth) records the signed-in user against the flow.
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.redirect(new URL('/api/facebook/auth', APP_ORIGIN));
}
