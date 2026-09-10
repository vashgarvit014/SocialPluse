import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes } from 'crypto';
import { CANVA_CLIENT_ID, takePendingDesign, takePendingDesignById, saveReadyDesign, APP_ORIGIN } from '@/lib/canva';

// Canva's own JSON Web Key Set - used to verify correlation_jwt was really
// issued by Canva and not forged by a caller hitting this endpoint directly.
// NOTE: this must be the api.canva.com host (per Canva's docs) - the
// www.canva.com host answers 403 here, which broke return navigation
// (jwtVerify throws before even checking the signature).
const JWKS = createRemoteJWKSet(new URL('https://api.canva.com/rest/v1/connect/keys'));

// Canva redirects the browser here (relayed via /content-studio, which is
// this integration's registered "Return URL") once the user finishes editing
// in the Canva editor. We only mark the design "ready" here - the actual
// export happens later, only when the user clicks "Import from Canva".
// The landing is /canva-return (a tiny client page): it postMessages the
// ready id back to the opener tab and closes itself. If there is no opener
// (e.g. same-tab fallback), it forwards to /?canva_ready= like before.
// https://www.canva.dev/docs/connect/return-navigation-guide/
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const correlationJwt = searchParams.get('correlation_jwt');
  const fail = (code: string) => NextResponse.redirect(new URL(`/canva-return?error=${code}`, APP_ORIGIN));

  if (!correlationJwt) return fail('CANVA_IMPORT_FAILED');

  try {
    const { payload } = await jwtVerify(correlationJwt, JWKS, { audience: CANVA_CLIENT_ID });
    const designId = payload.design_id as string;
    const correlationState = payload.correlation_state as string;
    if (!designId) return fail('CANVA_IMPORT_FAILED');

    // The JWT's design_id is trustworthy once verified, but we also cross-check
    // it against the design we actually created for this correlation_state -
    // belt and braces against a token that's valid but stale/replayed.
    // Fallback: Canva occasionally echoes an empty correlation_state (e.g. if
    // the state query param was lost on the edit URL) - then match by the
    // verified design_id instead of failing outright.
    const expectedDesignId = correlationState
      ? takePendingDesign(correlationState)
      : null;
    const matchedDesignId = expectedDesignId ?? takePendingDesignById(designId);
    if (!matchedDesignId || matchedDesignId !== designId) return fail('CANVA_IMPORT_FAILED');

    const readyId = randomBytes(16).toString('hex');
    saveReadyDesign(readyId, designId);

    return NextResponse.redirect(new URL(`/canva-return?canva_ready=${readyId}`, APP_ORIGIN));
  } catch (error) {
    console.error('Canva return-navigation error:', error);
    return fail('CANVA_IMPORT_FAILED');
  }
}
