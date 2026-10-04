import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { verifySession } from '@/lib/auth/dal';

// Internal-only session check for the gateway/extracted services.
//
// auth-service has NOT been extracted yet (deliberately last in the
// migration order), so the monolith is still the sole authority on session
// validity and roles. Rather than duplicate the JWT + sessionVersion +
// revoked-session-row logic in the gateway (a second implementation that
// could silently drift from this one), the gateway forwards the caller's
// session cookie here and trusts this single, existing, already-tested
// verifySession() — the same function every monolith route already calls.
//
// Guarded by INTERNAL_SERVICE_SECRET so only the gateway (not the public
// internet) can reach this. Returns ONLY userId + role — never the session
// cookie itself, never anything else about the user.
export async function GET(request: NextRequest) {
  const provided = request.headers.get('x-internal-secret') || '';
  const expected = process.env.INTERNAL_SERVICE_SECRET || '';
  const bufA = Buffer.from(provided);
  const bufB = Buffer.from(expected);
  const authorized = expected.length > 0 && bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  if (!authorized) {
    return NextResponse.json({ authenticated: false, error: 'INTERNAL_UNAUTHORIZED' }, { status: 401 });
  }

  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({ authenticated: true, userId: session.userId, role: session.user.role });
}
