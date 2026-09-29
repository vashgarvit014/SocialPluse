import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { getChallengeOwner, resendChallenge } from '@/lib/auth/otp';
import { deliverOtp } from '@/lib/auth/delivery';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { otpResendSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';

// Resend for an in-flight EMAIL_CHANGE challenge. Ownership + purpose are
// checked against the current Superadmin session (not a pending-auth
// cookie, which this flow never has) — resendChallenge rotates the code and
// the delivery goes to the stored new-email destination.
export async function POST(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const ip = clientIp(request);

  if (!(await checkRateLimit(`semail:resend:${session.userId}`, 10, 3600))) {
    return NextResponse.json({ error: 'Too many resend requests. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = otpResendSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const owner = await getChallengeOwner(parsed.data.challengeId);
  if (!owner || owner.userId !== session.userId || owner.purpose !== 'EMAIL_CHANGE') {
    return NextResponse.json({ error: 'This code is invalid or has expired. Please request a new one.' }, { status: 400 });
  }

  const result = await resendChallenge(parsed.data.challengeId);
  if (!result.ok) {
    if (result.reason === 'cooldown') {
      return NextResponse.json({ error: 'Please wait before requesting another code.', retryAfterMs: result.retryAfterMs }, { status: 429 });
    }
    if (result.reason === 'limit') {
      return NextResponse.json({ error: 'Maximum resend attempts reached. Please start again.' }, { status: 429 });
    }
    return NextResponse.json({ error: 'This code is invalid or has expired. Please request a new one.' }, { status: 400 });
  }

  const delivery = await deliverOtp({ channel: result.channel, destination: result.destination, otp: result.otp, purpose: result.purpose });
  if (!delivery.ok) {
    return NextResponse.json({ error: delivery.error }, { status: 502 });
  }
  logAuthEvent('SUPERADMIN_EMAIL_CHANGE_OTP_SENT', { userId: session.userId, ip, meta: { resend: true } });
  return NextResponse.json({ success: true, resendAvailableAt: result.resendAvailableAt });
}
