import { NextRequest, NextResponse } from 'next/server';
import { getPendingAuth, clearPendingAuth } from '@/lib/auth/pending-auth';
import { updatePassword } from '@/lib/auth/users';
import { hashPassword } from '@/lib/auth/password';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { resetPasswordSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';

export async function POST(request: NextRequest) {
  const pending = await getPendingAuth();
  // `verified` is only set by otp/verify after a successful PASSWORD_RESET
  // OTP check — this route is unreachable on the strength of the forgot-
  // password call alone.
  if (!pending || pending.purpose !== 'PASSWORD_RESET' || !pending.verified) {
    return NextResponse.json({ error: 'Verification required before resetting your password.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  // Same complexity rule as signup — never weaker for reset.
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { newPassword } = parsed.data;

  await updatePassword(pending.userId, hashPassword(newPassword));
  await clearPendingAuth();
  logAuthEvent('PASSWORD_RESET', { userId: pending.userId, ip: clientIp(request) });

  return NextResponse.json({ success: true });
}
