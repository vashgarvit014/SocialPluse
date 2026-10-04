import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { findUserByEmail, normalizeEmail, updateUserEmail } from '@/lib/auth/users';
import { getChallengeOwner, verifyChallenge } from '@/lib/auth/otp';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { otpVerifySchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';

const GENERIC_INVALID = 'This code is invalid or has expired. Please request a new one.';

// Step 2 of Superadmin email change: verify the code, then swap the address.
// Ordering is the safety: the new email comes from the VERIFIED challenge
// row (never from a second client field that could be swapped mid-flow),
// the duplicate check re-runs at commit time, and the UNIQUE constraint is
// the final backstop (23505 → clean 409). verifyChallenge marks the
// challenge used in the same step, so a code can never be replayed —
// combined, this is safe without a separate transaction wrapper.
export async function POST(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const ip = clientIp(request);

  if (!(await checkRateLimit(`semail:verify:${session.userId}`, 10, 3600))) {
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

  const owner = await getChallengeOwner(challengeId);
  if (!owner || owner.userId !== session.userId || owner.purpose !== 'EMAIL_CHANGE') {
    return NextResponse.json({ error: GENERIC_INVALID }, { status: 400 });
  }

  const result = await verifyChallenge(challengeId, otp);
  if (!result.ok) {
    const message =
      result.reason === 'incorrect'
        ? 'Incorrect code. Please try again.'
        : result.reason === 'too_many_attempts'
          ? 'Too many verification attempts. Please request a new code.'
          : GENERIC_INVALID;
    logAuthEvent('SUPERADMIN_EMAIL_CHANGE_FAILED', { userId: session.userId, ip, meta: { reason: result.reason } });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const next = normalizeEmail(result.destination);
  if (next === normalizeEmail(session.user.email)) {
    return NextResponse.json({ error: 'Please enter a different email address.' }, { status: 400 });
  }
  const taken = await findUserByEmail(next);
  if (taken && taken.id !== session.userId) {
    return NextResponse.json({ error: 'This email address is already in use.' }, { status: 409 });
  }

  try {
    await updateUserEmail(session.userId, next);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'This email address is already in use.' }, { status: 409 });
    }
    throw error;
  }
  logAuthEvent('SUPERADMIN_EMAIL_CHANGED', { userId: session.userId, ip });

  return NextResponse.json({ success: true, email: next });
}
