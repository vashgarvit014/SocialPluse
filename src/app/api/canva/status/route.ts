import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken, getCanvaProfile, setTokenCookies, clearTokenCookies, CanvaError } from '@/lib/canva';

// Real connection status, computed server-side from the httpOnly token
// cookies - never trust a client-side flag for this.
export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get('canva_access_token')?.value;
  const refreshToken = request.cookies.get('canva_refresh_token')?.value;
  const expiresAt = request.cookies.get('canva_expires_at')?.value;

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ connected: false });
  }

  try {
    const { accessToken: valid, refreshed } = await getValidAccessToken({ accessToken, refreshToken, expiresAt });
    const { displayName } = await getCanvaProfile(valid);
    const res = NextResponse.json({ connected: true, displayName });
    if (refreshed) setTokenCookies(res, refreshed);
    return res;
  } catch (e) {
    // A failed refresh (TOKEN_EXPIRED) can be transient (Canva hiccup,
    // tunnel blip) - wiping the refresh cookie here turned one bad minute
    // into a permanently dead session needing full reconnect. Keep the
    // cookies so the next check can retry; reconnecting overwrites them
    // anyway. Only wipe when there was nothing usable to begin with.
    const res = NextResponse.json({ connected: false });
    if (!(e instanceof CanvaError) || e.code !== 'CANVA_TOKEN_EXPIRED') {
      clearTokenCookies(res);
    }
    return res;
  }
}
