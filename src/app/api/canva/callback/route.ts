import { finishReturn, invalidReturnState } from '@/lib/oauth-return';
import { NextRequest } from 'next/server';
import { exchangeCodeForToken, getCanvaProfile, setTokenCookies, takePkceVerifier, CanvaError, APP_ORIGIN } from '@/lib/canva';

export async function GET(request: NextRequest) {
  if (invalidReturnState(request)) return finishReturn(request, new URL('/?error=state_mismatch', APP_ORIGIN));
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const fail = (code: string) => finishReturn(request, new URL(`/?error=${code}`, APP_ORIGIN));

  if (oauthError) return fail('CANVA_AUTH_FAILED');
  if (!code || !state) return fail('CANVA_STATE_MISMATCH');

  // Looking this up (and consuming it) is itself the state check: only a
  // state we generated and stored in /api/canva/auth will have an entry.
  const codeVerifier = takePkceVerifier(state);
  if (!codeVerifier) return fail('CANVA_STATE_MISMATCH');

  try {
    const token = await exchangeCodeForToken(code, codeVerifier);
    const { displayName } = await getCanvaProfile(token.access_token);

    const res = finishReturn(request,
      new URL(`/?canva_connected=true&canva_name=${encodeURIComponent(displayName)}`, APP_ORIGIN)
    );
    setTokenCookies(res, token);
    return res;
  } catch (err) {
    console.error('Canva callback error:', err);
    return fail(err instanceof CanvaError ? err.code : 'CANVA_AUTH_FAILED');
  }
}
