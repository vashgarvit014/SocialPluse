import 'server-only';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { cache } from 'react';
import { verifySession } from './dal';
import type { User } from './users';

// Role is deliberately NEVER embedded in the session JWT (see
// session.ts#SessionPayload — it only carries userId + sessionVersion).
// verifySession() re-reads the user's role from Postgres on every check, so
// revoking SUPERADMIN takes effect on that user's very next request, not
// only after their token expires or something bumps sessionVersion. Never
// add `role` to the cookie payload — that would reintroduce exactly the
// stale-privilege gap this design avoids.

// Page/layout use (Server Components) — redirects instead of returning
// null/throwing, matching dal.ts#requireSession's existing convention.
export const requireSuperadmin = cache(async (): Promise<{ userId: string; user: User }> => {
  const session = await verifySession();
  // /superadmin/login, not /login-signup: a signed-out visitor to a
  // Superadmin URL must land on the Superadmin form. The normal-user login
  // can never pass the role check below, so sending them there dead-ends
  // the flow. (An authenticated non-Superadmin still goes to their own
  // dashboard, not a login page — they are simply not an admin.)
  if (!session) redirect('/superadmin/login');
  if (session.user.role !== 'SUPERADMIN') redirect('/dashboard');
  return session;
});

// Route Handler use — never redirects (an API caller needs a status code,
// not an HTML redirect). Usage:
//   const session = await requireApiSuperadmin();
//   if (session instanceof NextResponse) return session;
// Returns 401 if not authenticated at all, 403 if authenticated but not
// SUPERADMIN — the two are deliberately distinguished per spec section 16.
export async function requireApiSuperadmin(): Promise<{ userId: string; user: User } | NextResponse> {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'SUPERADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return session;
}
