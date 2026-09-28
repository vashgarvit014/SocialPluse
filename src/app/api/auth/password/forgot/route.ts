import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { findUserByIdentifier } from '@/lib/auth/users';
import { isValidMobile, maskEmail, maskMobile } from '@/lib/auth/mobile';
import { setPendingAuth } from '@/lib/auth/pending-auth';
import { createChallenge } from '@/lib/auth/otp';
import { deliverOtp } from '@/lib/auth/delivery';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { forgotPasswordSchema } from '@/lib/auth/schemas';

const GENERIC_MESSAGE = 'If an account exists for the provided details, a verification code has been sent.';

// No channel-picker here on purpose, unlike signup/login: offering "send to
// email / send to WhatsApp" for a forgot-password request would itself leak
// which contact methods exist on the account before the requester has
// proven anything. The channel is instead implied by what they typed
// (an email address vs. a phone number) — never chosen from a list.
//
// Always returns the same shape (message + challengeId) whether or not the
// account exists, so the response alone reveals nothing; for a nonexistent
// account the challengeId is a random, never-stored value — the client
// still moves to the OTP-entry screen, and any code entered there just
// fails generically like a wrong/expired one would. See otp/verify's
// GENERIC_INVALID message.
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const dummy = () => NextResponse.json({ message: GENERIC_MESSAGE, challengeId: randomUUID(), resendAvailableAt: new Date(Date.now() + 60_000).toISOString() });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return dummy();
  }
  // Deliberately falls through to the same generic dummy() response on a
  // malformed body rather than a distinct VALIDATION_ERROR — this route's
  // whole point is that no response shape here should differ based on what
  // was submitted (see the "no channel-picker" note above).
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) return dummy();
  const { identifier } = parsed.data;

  if (!(await checkRateLimit(`password_forgot:ip:${ip}`, 10, 3600)) || !(await checkRateLimit(`password_forgot:identifier:${identifier.toLowerCase()}`, 5, 3600))) {
    return dummy();
  }

  const isEmail = identifier.includes('@');
  const channel = isEmail ? 'EMAIL' : 'WHATSAPP';
  if (!isEmail && !isValidMobile(identifier)) return dummy();

  const user = await findUserByIdentifier(identifier);
  // SUSPENDED is excluded on purpose (account-status enforcement must not be
  // bypassable via password reset), but PENDING is deliberately allowed
  // through here: this is the only path a Superadmin-created account
  // (users.ts#createAdminManagedUser — no usable password, must_set_password
  // = true) has to prove channel ownership and get its first real password,
  // and it's also a reasonable way for someone who abandoned signup
  // verification to still recover instead of being stuck forever. See
  // otp/verify/route.ts's PASSWORD_RESET branch, which activates the
  // account (markChannelVerified) the moment the OTP is verified.
  if (!user || user.status === 'SUSPENDED') return dummy();

  const destination = isEmail ? user.email : user.mobile;
  if (!destination) return dummy(); // e.g. account has no mobile on file

  const { challenge, otp } = await createChallenge({ userId: user.id, channel, destination, purpose: 'PASSWORD_RESET' });
  const delivery = await deliverOtp({ channel, destination, otp, purpose: 'PASSWORD_RESET' });
  if (!delivery.ok) {
    logAuthEvent('OTP_DELIVERY_FAILED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip });
    return dummy(); // still generic — don't reveal that delivery specifically failed for a real account
  }

  await setPendingAuth({ userId: user.id, purpose: 'PASSWORD_RESET' });
  logAuthEvent('OTP_REQUESTED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip });

  return NextResponse.json({
    message: GENERIC_MESSAGE,
    challengeId: challenge.challengeId,
    maskedDestination: isEmail ? maskEmail(destination) : maskMobile(destination),
    resendAvailableAt: challenge.resendAvailableAt,
  });
}
