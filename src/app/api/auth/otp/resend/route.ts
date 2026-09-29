import { NextRequest, NextResponse } from 'next/server';
import { getPendingAuth } from '@/lib/auth/pending-auth';
import { getChallengeOwner, resendChallenge } from '@/lib/auth/otp';
import { deliverOtp } from '@/lib/auth/delivery';
import { findUserById } from '@/lib/auth/users';
import { checkRateLimit, rateLimitRetryMs } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { otpResendSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';

export async function POST(request: NextRequest) {
  const pending = await getPendingAuth();
  if (!pending) return NextResponse.json({ error: 'Your verification session has expired. Please start again.' }, { status: 401 });

  const ip = clientIp(request);
  const IP_LIMIT_WINDOW = 3600;
  const USER_LIMIT_WINDOW = 3600;
  const ipAllowed = await checkRateLimit(`otp_resend:ip:${ip}`, 20, IP_LIMIT_WINDOW);
  const userAllowed = ipAllowed ? await checkRateLimit(`otp_resend:user:${pending.userId}`, 10, USER_LIMIT_WINDOW) : false;
  if (!ipAllowed || !userAllowed) {
    // Tell the client exactly when it may retry, so the UI can show a real
    // countdown instead of a button that only ever returns the same error.
    const retryAfterMs = await rateLimitRetryMs(
      ipAllowed ? `otp_resend:user:${pending.userId}` : `otp_resend:ip:${ip}`,
      ipAllowed ? USER_LIMIT_WINDOW : IP_LIMIT_WINDOW,
    );
    return NextResponse.json(
      { error: 'Too many resend requests. Please try again later.', retryAfterMs },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = otpResendSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { challengeId } = parsed.data;

  const owner = await getChallengeOwner(challengeId);
  if (!owner || owner.userId !== pending.userId || owner.purpose !== pending.purpose) {
    return NextResponse.json({ error: 'This code is invalid or has expired. Please request a new one.' }, { status: 400 });
  }

  const result = await resendChallenge(challengeId);
  if (!result.ok) {
    if (result.reason === 'cooldown') {
      return NextResponse.json({ error: 'Please wait before requesting another code.', retryAfterMs: result.retryAfterMs }, { status: 429 });
    }
    if (result.reason === 'limit') {
      return NextResponse.json({ error: 'Maximum resend attempts reached. Please start again.' }, { status: 429 });
    }
    return NextResponse.json({ error: 'This code is invalid or has expired. Please request a new one.' }, { status: 400 });
  }

  const delivery = await deliverOtp({
    channel: result.channel,
    destination: result.destination,
    otp: result.otp,
    purpose: result.purpose,
    isSuperadmin: (await findUserById(pending.userId))?.role === 'SUPERADMIN',
  });
  if (!delivery.ok) {
    logAuthEvent('OTP_DELIVERY_FAILED', { userId: pending.userId, channel: result.channel, purpose: result.purpose, ip });
    return NextResponse.json({ error: delivery.error }, { status: 502 });
  }

  logAuthEvent('OTP_REQUESTED', { userId: pending.userId, channel: result.channel, purpose: result.purpose, ip, meta: { resend: true } });
  return NextResponse.json({ success: true, resendAvailableAt: result.resendAvailableAt, expiresAt: result.expiresAt });
}
