import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// apps/superadmin owns NO database connection and imports no monolith
// library code — every check here is an HTTP call to auth-service, the
// same internal contract the gateway already uses for every other
// service's session verification (see infrastructure/gateway/src/
// server.mjs#authenticateRequest and services/auth-service/src/
// server.mjs's GET /internal/verify-session).
//
// This REPLACES src/lib/auth/roles.ts#requireSuperadmin and
// src/lib/auth/session.ts#getSession for this app only — apps/web keeps
// its own original (DB-backed) copies, unchanged.

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:4011';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
export const SESSION_COOKIE = 'sp_session';

export interface SuperadminSession {
  userId: string;
  role: string;
  accountStatus: string;
  sessionId: string | null;
}

async function callVerifySession(cookieValue: string | undefined): Promise<SuperadminSession | null> {
  if (!cookieValue) return null;
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/internal/verify-session`, {
      headers: {
        cookie: `${SESSION_COOKIE}=${cookieValue}`,
        'x-internal-secret': INTERNAL_SECRET,
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.authenticated) return null;
    return { userId: data.userId, role: data.role, accountStatus: data.accountStatus, sessionId: data.sessionId ?? null };
  } catch {
    // auth-service unreachable — fail closed, same as the gateway's own
    // authenticateRequest(). Never grant access when verification cannot
    // be performed.
    return null;
  }
}

/**
 * Reads the current request's session cookie and verifies it against
 * auth-service. Returns null if there is no session, the session is
 * invalid/expired/revoked, or the account is not currently ACTIVE —
 * auth-service's verifySessionFromCookieHeader() already enforces all of
 * that server-side (Phase 9), so this call is the single source of truth.
 */
export async function verifySuperadminSession(): Promise<SuperadminSession | null> {
  const cookieStore = await cookies();
  return callVerifySession(cookieStore.get(SESSION_COOKIE)?.value);
}

/**
 * Page/layout use — redirects instead of returning null, matching the
 * original requireSuperadmin()'s convention. Caller supplies the redirect
 * since this module has no Next.js `redirect()` dependency coupling.
 */
export async function requireSuperadminSession(): Promise<SuperadminSession | { redirect: true }> {
  const session = await verifySuperadminSession();
  if (!session) return { redirect: true };
  if (session.role !== 'SUPERADMIN') return { redirect: true };
  return session;
}

/**
 * Route Handler use — same ergonomics as the original requireApiSuperadmin():
 * 401 if unauthenticated, 403 if authenticated but not SUPERADMIN. Usage:
 *   const session = await requireApiSuperadminSession();
 *   if (session instanceof NextResponse) return session;
 */
export async function requireApiSuperadminSession(): Promise<SuperadminSession | NextResponse> {
  const session = await verifySuperadminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'SUPERADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return session;
}
