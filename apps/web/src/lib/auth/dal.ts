import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from './session';
import { findUserById, type User } from './users';
import { touchAndCheckSession } from './user-sessions';

// Secure check: reads the cookie AND verifies the user still exists in the
// DB AND that the session's embedded version still matches the user's
// current one (a password reset bumps it — see users.ts#updatePassword —
// which is what makes "invalidate previous sessions" actually invalidate
// them, not just be a comment). Use this (not proxy.ts's optimistic cookie
// check) before returning data or performing a mutation. Memoized per-request
// via React's cache().
export const verifySession = cache(async (): Promise<{ userId: string; user: User } | null> => {
  const session = await getSession();
  if (!session?.userId) return null;
  const user = await findUserById(session.userId);
  if (!user || user.status !== 'ACTIVE') return null;
  if (user.sessionVersion !== session.sessionVersion) return null;
  // A token with no sessionId claim predates user_sessions.ts and is still
  // trusted (see session.ts#SessionPayload) — everyone else's tracked row
  // must not be revoked (Superadmin "Terminate" — see
  // api/superadmin/sessions/[id]/route.ts) for the session to still count.
  if (session.sessionId && !(await touchAndCheckSession(session.sessionId))) return null;
  return { userId: session.userId, user };
});

// Redirects instead of returning null — use in Server Components / Route
// Handlers that require a signed-in user to render/respond at all.
export const requireSession = cache(async (): Promise<{ userId: string; user: User }> => {
  const session = await verifySession();
  if (!session) redirect('/login-signup');
  return session;
});

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await verifySession();
  return session?.user ?? null;
});
