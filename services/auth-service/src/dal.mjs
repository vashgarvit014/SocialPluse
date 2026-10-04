// Faithful port of src/lib/auth/dal.ts's verifySession, adapted to read the
// session cookie directly from a forwarded Cookie header instead of
// Next.js's cookies(). This is the ONE place "is this request really
// authenticated, as whom, with what role, is the account ACTIVE" gets
// decided — every other check in this service (and, via /internal/verify-
// session, every other service through the gateway) reduces to this.
//
// Secure check: reads the cookie AND verifies the user still exists AND is
// ACTIVE AND the session's embedded version still matches the user's
// current one (a password reset/change bumps it) AND, if the token carries
// a sessionId, that the tracked row isn't revoked. No memoization (no
// React cache() here) — this is a stateless HTTP service, not a
// request-scoped render tree.
import { parseCookies } from '../packages/cookies/index.mjs';
import { SESSION_COOKIE } from './session.mjs';

export function createDal({ sessionManager, usersRepo, userSessionsRepo }) {
  return {
    async verifySessionFromCookieHeader(cookieHeader) {
      const cookies = parseCookies(cookieHeader);
      const cookieValue = cookies[SESSION_COOKIE];
      if (!cookieValue) return null;
      const session = await sessionManager.readSession(cookieValue);
      if (!session?.userId) return null;
      const user = await usersRepo.findUserById(session.userId);
      if (!user || user.status !== 'ACTIVE') return null;
      if (user.sessionVersion !== session.sessionVersion) return null;
      // A token with no sessionId claim predates user_sessions and is still
      // trusted — everyone else's tracked row must not be revoked.
      if (session.sessionId && !(await userSessionsRepo.touchAndCheckSession(session.sessionId))) return null;
      return { userId: session.userId, sessionId: session.sessionId ?? null, user };
    },
  };
}
