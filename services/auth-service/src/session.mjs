// Faithful port of src/lib/auth/session.ts, adapted from Next.js's
// `cookies()` API to raw node:http via packages/cookies — same JWT shape,
// same cookie flags (httpOnly, secure in production, sameSite lax for
// OAuth-redirect compatibility), same 7-day expiry. Do NOT weaken any of
// this during extraction.
import { SignJWT, jwtVerify } from 'jose';
import { serializeCookie } from '../packages/cookies/index.mjs';

export const SESSION_COOKIE = 'sp_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getEncodedKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set.');
  return new TextEncoder().encode(secret);
}

async function encrypt(payload) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(getEncodedKey());
}

async function decrypt(session) {
  if (!session) return null;
  try {
    const { payload } = await jwtVerify(session, getEncodedKey(), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionManager(userSessionsRepo) {
  return {
    // Called only after OTP verification succeeds. Returns the Set-Cookie
    // string for the caller to attach to the HTTP response.
    async createSession(userId, sessionVersion, meta = {}) {
      const sessionId = await userSessionsRepo.createUserSession(userId, meta.userAgent ?? null, meta.ip ?? null);
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
      const session = await encrypt({ userId, sessionVersion, sessionId });
      const cookieString = serializeCookie(SESSION_COOKIE, session, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        // Lax, not Strict: OAuth-style provider redirects land back on our
        // app as a top-level GET from a third-party origin — Strict would
        // drop the cookie on that hop.
        sameSite: 'Lax',
        maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      });
      return { cookieString, sessionId };
    },

    async deleteSession(cookieValue) {
      const current = await decrypt(cookieValue);
      if (current?.sessionId) await userSessionsRepo.revokeSession(current.sessionId);
      // Max-Age=0 clears the cookie in the browser.
      return serializeCookie(SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax', maxAge: 0 });
    },

    async readSession(cookieValue) {
      return decrypt(cookieValue);
    },
  };
}
