import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { findUserByEmail, normalizeEmail } from '@/lib/auth/users';
import { createChallenge } from '@/lib/auth/otp';
import { deliverOtp } from '@/lib/auth/delivery';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { emailSchema } from '@/lib/auth/schemas';
import { z } from 'zod';

const requestSchema = z.object({ newEmail: emailSchema });

// Step 1 of Superadmin email change: validate the NEW address, create an
// EMAIL_CHANGE challenge addressed to it, and send the OTP there (never to
// the old address). users.email is NOT touched here — only the verify step
// updates it, after OTP success.
export async function POST(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const ip = clientIp(request);

  if (!(await checkRateLimit(`semail:req:${session.userId}`, 5, 3600))) {
    return NextResponse.json({ error: 'Too many email-change attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }
  const next = normalizeEmail(parsed.data.newEmail);
  if (next === normalizeEmail(session.user.email)) {
    return NextResponse.json({ error: 'Please enter a different email address.' }, { status: 400 });
  }
  if (await findUserByEmail(next)) {
    return NextResponse.json({ error: 'This email address is already in use.' }, { status: 409 });
  }

  const { challenge, otp } = await createChallenge({ userId: session.userId, channel: 'EMAIL', destination: next, purpose: 'EMAIL_CHANGE' });
  logAuthEvent('SUPERADMIN_EMAIL_CHANGE_REQUESTED', { userId: session.userId, ip });
  const delivery = await deliverOtp({ channel: 'EMAIL', destination: next, otp, purpose: 'EMAIL_CHANGE' });
  if (!delivery.ok) {
    return NextResponse.json({ error: delivery.error }, { status: 502 });
  }
  logAuthEvent('SUPERADMIN_EMAIL_CHANGE_OTP_SENT', { userId: session.userId, ip });

  return NextResponse.json({ challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, resendAvailableAt: challenge.resendAvailableAt });
}
