import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { buildAuthorizeUrl, generateCodeVerifier, codeChallengeFromVerifier, savePkceVerifier } from '@/lib/canva';

// Starts the Canva Connect OAuth2 + PKCE flow. The code_verifier is stored
// server-side, keyed by `state` (see savePkceVerifier) - not in a cookie,
// since cookies set right before a redirect to Canva don't reliably survive
// the cross-site hop back on every browser/privacy setting. `state` itself
// doesn't need a cookie either: Canva echoes it back verbatim in the
// callback's query string, which is what we look it up by.
export async function GET() {
  const state = randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);

  savePkceVerifier(state, codeVerifier);

  return NextResponse.redirect(buildAuthorizeUrl(state, codeChallenge));
}
