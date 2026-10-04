import { startReturn } from '@/lib/oauth-return';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { saveOAuthState } from '@/lib/oauth-state';
import { logSystem } from '@/lib/system-log';

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/linkedin/callback';

// Starting a connection requires being signed in: the userId recorded here is
// what the callback later binds the token to. Without this check an
// unauthenticated visitor could start a flow that writes into the vault.
export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const scope = 'openid profile email w_member_social';
  // crypto CSPRNG (see oauth-state.ts) — was Math.random().substring(7), which
  // is predictable and made the state parameter forgeable.
  const state = await saveOAuthState('linkedin', session.userId);

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
    `response_type=code&` +
    `client_id=${LINKEDIN_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(LINKEDIN_REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(scope)}&` +
    `state=${state}`;

  logSystem({ level: 'INFO', category: 'PLATFORM', event: 'LINKEDIN_AUTH_STARTED', userId: session.userId, platform: 'linkedin', message: 'LinkedIn OAuth flow started' });
  return startReturn(request, NextResponse.redirect(authUrl), state);
}