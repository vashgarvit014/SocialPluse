import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { findUserByEmail, updatePassword, findUserById } from '@/lib/auth/users';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { sendPasswordChangedEmail } from '@/lib/auth/delivery/email';
import { passwordSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';
import { z } from 'zod';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: passwordSchema,
  confirmPassword: z.string().min(1, 'Please confirm the new password.'),
});

// Self-service password change for the seeded Superadmin. Current password
// is verified server-side against the stored hash; the new password goes
// through the same policy as everywhere else and must differ. updatePassword
// bumps session_version (killing ALL sessions incl. this one), so a fresh
// session is immediately re-issued for this browser — other sessions stay
// dead. Nothing secret is ever logged.
export async function POST(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const ip = clientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  const full = await findUserByEmail(session.user.email);
  if (!full) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  if (!verifyPassword(currentPassword, full.passwordHash)) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: 'New password and confirmation do not match.' }, { status: 400 });
  }
  if (verifyPassword(newPassword, full.passwordHash)) {
    return NextResponse.json({ error: 'New password must be different from your current password.' }, { status: 400 });
  }

  await updatePassword(session.userId, hashPassword(newPassword));
  const updated = await findUserById(session.userId);
  if (updated) {
    await createSession(updated.id, updated.sessionVersion, {
      userAgent: request.headers.get('user-agent'),
      ip,
    });
  }

  // Confirmation notice to the account's own address. Best-effort and fired
  // only after the new password is live, so a mail failure can never roll back
  // (or block) the change itself — it just gets logged.
  const notification = await sendPasswordChangedEmail({
    to: full.email,
    changedAt: new Date(),
    ip,
    userAgent: request.headers.get('user-agent'),
  });
  if (!notification.ok) console.error('[superadmin/settings/password] change notice not delivered:', notification.error);

  logAuthEvent('SUPERADMIN_PASSWORD_CHANGED', {
    userId: session.userId,
    ip,
    meta: { notified: notification.ok },
  });

  return NextResponse.json({ success: true, notified: notification.ok });
}
