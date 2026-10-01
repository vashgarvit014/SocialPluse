import { NextRequest, NextResponse } from 'next/server';
import { getPendingAuth, setPendingAuth, clearPendingAuth } from '@/lib/auth/pending-auth';
import { findUserById, markChannelVerified, recordLogin } from '@/lib/auth/users';
import { getChallengeOwner, verifyChallenge } from '@/lib/auth/otp';
import { createSession } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { otpVerifySchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';
import { isPublicHost, normalizeHost, SUPERADMIN_ORIGIN } from '@/lib/admin-host';

const GENERIC_INVALID = 'This code is invalid or has expired. Please request a new one.';

const REASON_MESSAGE: Record<string, string> = {
  not_found: GENERIC_INVALID,
  invalid: GENERIC_INVALID,
  expired: GENERIC_INVALID,
  incorrect: 'Incorrect code. Please try again.',
  too_many_attempts: 'Too many verification attempts. Please request a new code.',
};

export async function POST(request: NextRequest) {
  const pending = await getPendingAuth();
  if (!pending) return NextResponse.json({ error: 'Your verification session has expired. Please start again.' }, { status: 401 });

  const ip = clientIp(request);
  if (!(await checkRateLimit(`otp_verify:ip:${ip}`, 30, 3600))) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = otpVerifySchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { challengeId, otp } = parsed.data;

  if (!(await checkRateLimit(`otp_verify:challenge:${challengeId}`, 10, 300))) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  // The challenge must actually belong to whoever holds this pending-auth
  // cookie, for this exact purpose — a random valid challengeId for someone
  // else's login attempt must never verify here.
  const owner = await getChallengeOwner(challengeId);
  if (!owner || owner.userId !== pending.userId || owner.purpose !== pending.purpose) {
    return NextResponse.json({ error: GENERIC_INVALID }, { status: 400 });
  }

  const result = await verifyChallenge(challengeId, otp);
  if (!result.ok) {
    logAuthEvent('OTP_FAILED', { userId: pending.userId, purpose: pending.purpose, ip, meta: { reason: result.reason } });
    return NextResponse.json({ error: REASON_MESSAGE[result.reason] }, { status: 400 });
  }

  logAuthEvent('OTP_VERIFIED', { userId: result.userId, channel: result.channel, purpose: result.purpose, ip });

  if (result.purpose === 'PASSWORD_RESET') {
    // Verifying an OTP on any channel proves ownership of that channel —
    // if the account was still PENDING (this is exactly the path a
    // Superadmin-created account uses to first activate itself: no
    // password is set by the admin, so the user proves ownership via
    // "Forgot Password" instead of a normal login — see
    // users.ts#createAdminManagedUser), treat this the same as a signup
    // verification and activate it now, rather than leaving it stuck
    // PENDING forever just because the OTP happened to arrive via the
    // password-reset purpose instead of signup-verify.
    await markChannelVerified(result.userId, result.channel);
    // Don't create a session yet — just re-issue the pending-auth cookie
    // marked verified, which is what /api/auth/password/reset requires.
    await setPendingAuth({ userId: result.userId, purpose: 'PASSWORD_RESET', verified: true });
    return NextResponse.json({ success: true, canResetPassword: true });
  }

  // SIGNUP_VERIFY or LOGIN_VERIFY: this is the one point where a real
  // session gets created — never before OTP verification succeeds.
  await markChannelVerified(result.userId, result.channel);
  const user = await findUserById(result.userId);
  if (!user) return NextResponse.json({ error: GENERIC_INVALID }, { status: 400 });

  await createSession(user.id, user.sessionVersion, { userAgent: request.headers.get('user-agent'), ip });
  await recordLogin(user.id);
  await clearPendingAuth();
  logAuthEvent('LOGIN_SUCCESS', { userId: user.id, ip, purpose: result.purpose });

  // Role-aware landing page (spec section 23) — decided server-side from a
  // fresh DB read (`user.role`), never trusted from the client. A plain
  // USER always lands on /dashboard regardless of what it asks for.
  //
  // A SUPERADMIN needs the host in the answer, not just the path: the admin
  // console is served only from its own subdomain and /superadmin 404s on the
  // public site (see src/proxy.ts). Handing back a bare "/superadmin" would
  // drop them on a 404, so when the verification happened on the PUBLIC host
  // we return the admin ORIGIN instead. On the admin host — and in local
  // development, which matches neither host set — the same-origin relative
  // path is kept.
  const host = normalizeHost(request.headers.get('host'));
  const redirect = user.role !== 'SUPERADMIN'
    ? '/dashboard'
    : isPublicHost(host)
      ? `${SUPERADMIN_ORIGIN}/superadmin`
      : '/superadmin';
  return NextResponse.json({ success: true, redirect });
}
