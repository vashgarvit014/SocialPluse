// Faithful port of src/lib/oauth-return.ts for plain Node req/res.
import { appendSetCookie, serializeCookie, parseCookies } from '../packages/cookies/index.mjs';

export const RETURN_COOKIE = 'sp_editor_return';

export function startReturn(cookies, res, state, isHttps) {
  const hint = cookies[RETURN_COOKIE];
  if (hint) {
    try {
      const value = JSON.parse(hint);
      if (/^[a-f0-9-]{36}$/.test(value.id)) {
        appendSetCookie(res, serializeCookie(RETURN_COOKIE, JSON.stringify({ ...value, state }), {
          httpOnly: true, secure: isHttps, sameSite: 'Lax', path: '/', maxAge: 1800,
        }));
      }
    } catch { /* Unrelated or invalid return cookie does not change provider auth. */ }
  }
}

// Returns the redirect target URL (string) — caller issues the 302 itself,
// since this module doesn't own the http response status line.
export function finishReturn(cookieHeader, requestState, target) {
  let result = target;
  try {
    const value = JSON.parse(parseCookies(cookieHeader)[RETURN_COOKIE] || 'null');
    if (value && /^[a-f0-9-]{36}$/.test(value.id)) {
      result = new URL('/oauth-return', target.origin);
      result.searchParams.set('editor_return', value.id);
      result.searchParams.set('provider', value.platform);
      for (const key of ['error', 'connected', 'canva_connected']) {
        const entry = target.searchParams.get(key);
        if (entry) result.searchParams.set(key, entry);
      }
      if (value.state !== requestState) {
        result.searchParams.delete('connected');
        result.searchParams.delete('canva_connected');
        result.searchParams.set('error', 'Connection state did not match. Please connect again.');
      }
    }
  } catch { /* Preserve existing callback behavior for non-editor flows. */ }
  return result;
}

export function clearReturnCookie(res, isHttps) {
  appendSetCookie(res, serializeCookie(RETURN_COOKIE, '', { httpOnly: true, secure: isHttps, sameSite: 'Lax', path: '/', maxAge: 0 }));
}
