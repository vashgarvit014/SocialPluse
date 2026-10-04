import { startReturn } from '@/lib/oauth-return';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { buildAuthorizeUrl, generateCodeVerifier, codeChallengeFromVerifier } from '@/lib/canva';
import { savePkceVerifier } from '@/lib/canva-handoffs';
import { requireApiSession } from '@/lib/auth/api';

// Starts the Canva Connect OAuth2 + PKCE flow. The code_verifier is stored
// server-side, keyed by `state` (see savePkceVerifier) - not in a cookie,
// since cookies set right before a redirect to Canva don't reliably survive
// the cross-site hop back on every browser/privacy setting. `state` itself
// doesn't need a cookie either: Canva echoes it back verbatim in the
// callback's query string, which is what we look it up by.
//
// The verifier row also records WHICH user started the flow, and
// /api/canva/callback reads it back to bind the resulting tokens to that user.
// Without this the route was reachable unauthenticated, so any visitor could
// seed a PKCE entry into the shared store.
export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const state = randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);

  await savePkceVerifier(session.userId, state, codeVerifier);

  return startReturn(request, NextResponse.redirect(buildAuthorizeUrl(state, codeChallenge)), state);
}