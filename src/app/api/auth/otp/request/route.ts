import { NextRequest, NextResponse } from 'next/server';
import { getPendingAuth } from '@/lib/auth/pending-auth';
import { findUserById } from '@/lib/auth/users';
import { createChallenge } from '@/lib/auth/otp';
import { deliverOtp } from '@/lib/auth/delivery';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { otpRequestSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';
import { isValidEmailFormat } from '@/lib/auth/format-rules';
import { isValidMobile } from '@/lib/auth/mobile';

const SESSION_EXPIRED = 'Your verification session has expired. Please start again.';

export async function POST(request: NextRequest) {
  const pending = await getPendingAuth();
  if (!pending) return NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 });

  const ip = clientIp(request);
  if (!(await checkRateLimit(`otp_request:ip:${ip}`, 20, 3600)) || !(await checkRateLimit(`otp_request:user:${pending.userId}`, 10, 3600))) {
    return NextResponse.json({ error: 'Too many verification code requests. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = otpRequestSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { channel } = parsed.data;

  const user = await findUserById(pending.userId);
  if (!user) return NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 });

  const destination = channel === 'EMAIL' ? user.email : user.mobile;
  if (!destination) {
    return NextResponse.json({ error: 'WhatsApp is not available for this account — no mobile number on file. Please use Email.' }, { status: 400 });
  }
  // Belt-and-braces: the stored value was schema-validated at signup, but
  // never hand a malformed destination to SMTP/Meta regardless of how it
  // got into the row (legacy data, manual DB edit, future import, etc.).
  const destinationValid = channel === 'EMAIL' ? isValidEmailFormat(destination) : isValidMobile(destination);
  if (!destinationValid) {
    return NextResponse.json({ error: 'This account has no valid destination on file for that channel. Please contact support.' }, { status: 400 });
  }

  const { challenge, otp } = await createChallenge({ userId: user.id, channel, destination, purpose: pending.purpose });
  const delivery = await deliverOtp({ channel, destination, otp, purpose: pending.purpose });

  if (!delivery.ok) {
    logAuthEvent('OTP_DELIVERY_FAILED', { userId: user.id, channel, purpose: pending.purpose, ip });
    return NextResponse.json({ error: delivery.error }, { status: 502 });
  }

  logAuthEvent('OTP_REQUESTED', { userId: user.id, channel, purpose: pending.purpose, ip });
  return NextResponse.json({
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
    resendAvailableAt: challenge.resendAvailableAt,
  });
}
