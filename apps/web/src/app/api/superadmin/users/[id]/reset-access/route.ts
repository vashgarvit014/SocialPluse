import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { findUserById } from '@/lib/auth/users';
import { createChallenge } from '@/lib/auth/otp';
import { deliverOtp } from '@/lib/auth/delivery';
import { maskEmail, maskMobile } from '@/lib/auth/mobile';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';

// Reuses the exact same OTP engine + PASSWORD_RESET purpose as the
// self-service "Forgot Password" flow (see password/forgot/route.ts) —
// there is no separate reset mechanism for Superadmin to invoke. The
// Superadmin never sets, sees, or generates a password here; this only
// sends the user a fresh code to their own email/WhatsApp so THEY can set
// a new password themselves via the normal reset screen. This is also how
// a Superadmin-created (must_set_password) account gets its first working
// password, and how a still-PENDING account gets activated — see
// otp/verify/route.ts's PASSWORD_RESET branch.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const user = await findUserById(id);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (user.status === 'SUSPENDED') {
    return NextResponse.json({ error: 'This account is suspended. Reactivate it before resetting access.' }, { status: 400 });
  }

  const channel = user.email ? 'EMAIL' : 'WHATSAPP';
  const destination = user.email || user.mobile;
  if (!destination) return NextResponse.json({ error: 'This account has no email or mobile on file.' }, { status: 400 });

  const { otp } = await createChallenge({ userId: user.id, channel, destination, purpose: 'PASSWORD_RESET' });
  const delivery = await deliverOtp({ channel, destination, otp, purpose: 'PASSWORD_RESET' });
  if (!delivery.ok) {
    logAuthEvent('OTP_DELIVERY_FAILED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip: clientIp(request) });
    return NextResponse.json({ error: 'Could not send the verification code. Please try again shortly.' }, { status: 502 });
  }

  logAuthEvent('RESET_ACCESS_TRIGGERED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip: clientIp(request), meta: { actorUserId: session.userId } });

  return NextResponse.json({
    success: true,
    message: 'A verification code has been sent to the user. They can complete the reset from the login page (Forgot Password).',
    maskedDestination: channel === 'EMAIL' ? maskEmail(destination) : maskMobile(destination),
  });
}
