import { NextRequest, NextResponse } from 'next/server';
export const RETURN_COOKIE = 'sp_editor_return';
export function invalidReturnState(request: NextRequest) {
  try {
    const value = JSON.parse(request.cookies.get(RETURN_COOKIE)?.value || 'null');
    return !!value && value.state !== request.nextUrl.searchParams.get('state');
  } catch { return true; }
}
export function startReturn(request: NextRequest, response: NextResponse, state: string) {
  const hint = request.cookies.get(RETURN_COOKIE)?.value;
  if (hint) {
    try {
      const value = JSON.parse(hint);
      if (/^[a-f0-9-]{36}$/.test(value.id)) response.cookies.set(RETURN_COOKIE, JSON.stringify({ ...value, state }), { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 1800 });
    } catch { /* Unrelated or invalid return cookie does not change provider auth. */ }
  }
  return response;
}
export function finishReturn(request: NextRequest, target: URL): NextResponse {
  let result = target;
  try {
    const value = JSON.parse(request.cookies.get(RETURN_COOKIE)?.value || 'null');
    if (value && /^[a-f0-9-]{36}$/.test(value.id)) {
      result = new URL('/oauth-return', target.origin);
      result.searchParams.set('editor_return', value.id);
      result.searchParams.set('provider', value.platform);
      // Only display/status fields. Never forward codes, tokens or arbitrary URLs.
      for (const key of ['error', 'connected', 'canva_connected']) {
        const entry = target.searchParams.get(key); if (entry) result.searchParams.set(key, entry);
      }
      if (value.state !== request.nextUrl.searchParams.get('state')) {
        result.searchParams.delete('connected'); result.searchParams.delete('canva_connected');
        result.searchParams.set('error', 'Connection state did not match. Please connect again.');
      }
    }
  } catch { /* Preserve existing callback behavior for non-editor flows. */ }
  const response = NextResponse.redirect(result);
  response.cookies.delete(RETURN_COOKIE);
  return response;
}
