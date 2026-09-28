import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { createUserSession, revokeSession } from './user-sessions';

// Read lazily (not at module load) so `next build` still succeeds when run
// without secrets present, per this project's existing convention (see
// Dockerfile: ".env files are NOT copied via .dockerignore — build must
// succeed without secrets"). Actually creating/reading a session at request
// time still fails loudly if the key is missing.
function getEncodedKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.');
  }
  return new TextEncoder().encode(secret);
}

export const SESSION_COOKIE = 'sp_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionPayload {
  userId: string;
  // Bumped on password reset (see users.ts#bumpSessionVersion). A session
  // whose embedded version no longer matches the user's current one is
  // treated as invalid — this is how "password reset invalidates previous
  // sessions" works without a server-side session store to revoke from.
  sessionVersion: number;
  // Optional on purpose: a token issued before user_sessions.ts existed has
  // no sessionId claim. dal.ts#verifySession treats that as "not tracked,
  // still valid" (grandfathered) rather than logging out everyone the
  // moment this shipped — see its own comment.
  sessionId?: string;
  [key: string]: unknown;
}

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getEncodedKey());
}

async function decrypt(session: string | undefined): Promise<SessionPayload | null> {
  if (!session) return null;
  try {
    const { payload } = await jwtVerify(session, getEncodedKey(), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'string') return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

// Called only from Server Actions / Route Handlers (login, signup) — never
// from a component render. Only ever called AFTER OTP verification succeeds
// (or, for pre-existing grandfathered users, after password verification —
// see otp/verify and login routes) — never on password check alone.
export async function createSession(userId: string, sessionVersion: number, meta?: { userAgent?: string | null; ip?: string | null }) {
  const sessionId = await createUserSession(userId, meta?.userAgent ?? null, meta?.ip ?? null);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encrypt({ userId, sessionVersion, sessionId });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax (not Strict): OAuth-style provider redirects (Canva, LinkedIn,
    // Facebook) land back on our app as a top-level GET navigation from a
    // third-party origin — Strict would drop the cookie on that hop.
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export async function deleteSession() {
  const current = await getSession();
  if (current?.sessionId) await revokeSession(current.sessionId);
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// Optimistic-check helper for proxy.ts — reads + verifies the cookie only,
// no DB hit. Do not use this for authorization decisions inside route
// handlers/Server Actions; use getCurrentUser() from dal.ts there instead.
export async function readSessionFromCookieValue(value: string | undefined): Promise<SessionPayload | null> {
  return decrypt(value);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get(SESSION_COOKIE)?.value);
}
