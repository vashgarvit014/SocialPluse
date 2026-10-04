import { finishReturn } from '@/lib/oauth-return';
import { NextRequest } from 'next/server';
import { exchangeCodeForToken, getCanvaProfile, setTokenCookies, CanvaError, APP_ORIGIN } from '@/lib/canva';
import { takePkceVerifierUser } from '@/lib/canva-handoffs';
import { logSystem } from '@/lib/system-log';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const fail = (code: string) => finishReturn(request, new URL(`/dashboard?error=${code}`, APP_ORIGIN));

  if (oauthError) return fail('CANVA_AUTH_FAILED');
  if (!code || !state) return fail('CANVA_STATE_MISMATCH');

  // Looking this up (and consuming it) is itself the state check: only a
  // state we generated in /api/canva/auth - for a signed-in user - will have
  // an entry. Consuming it is what binds the returned tokens to that user.
  //
  // The PKCE verifier is the only proof of who started the flow, so it must be
  // read BEFORE exchanging the code: after the exchange we would have nothing
  // left to identify the user with.
  const { userId, data } = (await takePkceVerifierUser(state)) ?? {};
  const codeVerifier = data?.codeVerifier;
  if (!userId || !codeVerifier) return fail('CANVA_STATE_MISMATCH');

  try {
    const token = await exchangeCodeForToken(code, codeVerifier);
    const { displayName } = await getCanvaProfile(token.access_token);

    const res = finishReturn(request,
      new URL(`/dashboard?canva_connected=true&canva_name=${encodeURIComponent(displayName)}`, APP_ORIGIN)
    );
    setTokenCookies(res, token);
    logSystem({ level: 'SUCCESS', category: 'PLATFORM', event: 'CANVA_CONNECTED', userId, platform: 'canva', message: `Canva connected${displayName ? ` (${displayName})` : ''}` });
    return res;
  } catch (err) {
    console.error('Canva callback error:', err);
    return fail(err instanceof CanvaError ? err.code : 'CANVA_AUTH_FAILED');
  }
}
