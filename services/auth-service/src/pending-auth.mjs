// Faithful port of src/lib/auth/pending-auth.ts. Short-lived, separate from
// the real session cookie: proves "this client just validated a password
// (or identifier, for forgot-password) for this user" so otp/request and
// otp/verify know which user+purpose they're operating on without trusting
// a client-supplied userId.
import { SignJWT, jwtVerify } from 'jose';
import { serializeCookie } from '../packages/cookies/index.mjs';

export const PENDING_AUTH_COOKIE = 'sp_pending_auth';
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

function getEncodedKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set.');
  return new TextEncoder().encode(secret);
}

export async function setPendingAuth(payload) {
  const token = await new SignJWT({ ...payload, typ: 'pending_auth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + PENDING_AUTH_TTL_MS) / 1000))
    .sign(getEncodedKey());
  return serializeCookie(PENDING_AUTH_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax', maxAge: PENDING_AUTH_TTL_MS / 1000,
  });
}

export async function getPendingAuth(cookieValue) {
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, getEncodedKey(), { algorithms: ['HS256'] });
    if (payload.typ !== 'pending_auth' || typeof payload.userId !== 'string' || typeof payload.purpose !== 'string') return null;
    return { userId: payload.userId, purpose: payload.purpose, verified: payload.verified === true };
  } catch {
    return null;
  }
}

export function clearPendingAuth() {
  return serializeCookie(PENDING_AUTH_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax', maxAge: 0 });
}
