import 'server-only';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';

export const INTERNAL_HEADER = 'x-socialpulse-internal-actor';

// Identity for server-to-server calls the app makes to itself.
//
// The publish worker (/api/scheduler/check) has to reach the platform publish
// routes for posts owned by *many* users, including users who are not the one
// whose browser triggered the tick. It cannot do that with a session cookie,
// so it carries an HMAC-signed assertion instead.
//
// Why this and not "just trust the userId in the body": the body userId is
// client-controlled on these same routes. A signed assertion is the only
// thing that distinguishes "the scheduler is asking to publish as User A" from
// "User B typed User A's id into a JSON body".
//
// The assertion is minted with a per-process random secret when
// INTERNAL_PUBLISH_SECRET is unset, so a misconfigured deployment still gets
// an unguessable value rather than a shared literal. The consequence of that
// fallback is that a restarted server invalidates in-flight internal calls —
// acceptable, since they are short-lived — and that multi-instance deploys
// MUST set INTERNAL_PUBLISH_SECRET.

const SECRET = process.env.INTERNAL_PUBLISH_SECRET || randomBytes(32).toString('hex');

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface InternalActor {
  userId: string;
  issuedAt: number;
}

/** Mints a short-lived signed assertion for an in-process publish call. */
export function signInternalActor(userId: string, issuedAt = Date.now()): string {
  const payload = `${userId}.${issuedAt}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the asserted userId, or null when the header is absent/forged/expired. */
export function verifyInternalActor(header: string | null): InternalActor | null {
  if (!header) return null;
  const parts = header.split('.');
  if (parts.length !== 3) return null;
  const [userId, issuedAtRaw, mac] = parts;
  if (!userId || !/^\d{13}$/.test(issuedAtRaw)) return null;
  if (!safeEqual(sign(`${userId}.${issuedAtRaw}`), mac)) return null;
  const issuedAt = Number(issuedAtRaw);
  // 10 minutes is far longer than a publish attempt and short enough that a
  // captured header is useless by the time it could be replayed.
  if (Date.now() - issuedAt > 10 * 60 * 1000) return null;
  return { userId, issuedAt };
}

export function internalActorHeaders(userId: string): Record<string, string> {
  return { [INTERNAL_HEADER]: signInternalActor(userId) };
}

/**
 * The one rule every publish route follows to decide *whose* stored OAuth
 * credential to use:
 *
 *   - A valid signed internal assertion wins: the scheduler is legitimately
 *     acting for the post's recorded owner.
 *   - Otherwise the caller is the session user, full stop.
 *
 * Note there is deliberately NO way for a request to name a different user.
 * A `userId` in the body is never consulted for credential selection: on
 * these routes that field carries the PROVIDER's member id (LinkedIn `sub`,
 * Meta profile id), not a SocialPulse id, so treating it as an app-user claim
 * would be both wrong and — before this change — was the cross-user token
 * leak. Per-account targeting within a user's own accounts (e.g. choosing one
 * of their Facebook Pages) is still supported; it is just filtered by the
 * session user's own connection row.
 */
export function resolvePublishActor(request: Request, sessionUserId: string): string {
  const internal = verifyInternalActor(request.headers.get(INTERNAL_HEADER));
  return internal ? internal.userId : sessionUserId;
}

/**
 * Gate for the platform publish routes, which have two legitimate callers:
 *
 *   1. A signed-in browser publishing now.
 *   2. The publish worker, server-to-server, for a post owned by some user who
 *      is not the one whose browser triggered the tick. That call carries an
 *      HMAC assertion and NO session cookie — there is no browser, and
 *      forwarding the triggering user's cookie would publish as the wrong
 *      person.
 *
 * requireApiSession() alone rejects (2) with a 401 before the assertion is
 * ever read, which silently broke every scheduled post. This checks the
 * assertion FIRST and only falls back to the session.
 *
 * The assertion is still not enough to do anything a session couldn't: it only
 * chooses which OWNER'S stored credential to use, and credentials are always
 * read from that owner's own connection row.
 */
export async function requireApiActor(
  request: Request,
): Promise<{ userId: string; via: 'internal' | 'session' } | NextResponse> {
  const internal = verifyInternalActor(request.headers.get(INTERNAL_HEADER));
  if (internal) return { userId: internal.userId, via: 'internal' };
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  return { userId: session.userId, via: 'session' };
}