import { NextRequest, NextResponse } from 'next/server';
import { findUserByIdentifier } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { maskEmail, maskMobile } from '@/lib/auth/mobile';
import { setPendingAuth } from '@/lib/auth/pending-auth';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { loginSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';

// Separate Superadmin login (POST from /superadmin/login only). Mirrors
// /api/auth/login step-for-step (password → pending-auth → OTP via the
// shared /api/auth/otp/* endpoints) with one extra server-side gate: the
// account's role must already be SUPERADMIN, otherwise the same generic 401
// (no enumeration of which check failed). No session is created here —
// /api/auth/otp/verify creates it after OTP, exactly like the normal flow.
const GENERIC_ERROR = 'Invalid email/mobile or password.';

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(`slogin:ip:${ip}`, 20, 3600))) {
    return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { identifier, password } = parsed.data;

  if (!(await checkRateLimit(`slogin:identifier:${identifier.toLowerCase()}`, 10, 3600))) {
    return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
  }

  const user = await findUserByIdentifier(identifier);
  // role is part of the credential check itself: a valid USER password here
  // still fails closed with the identical generic message.
  if (!user || !verifyPassword(password, user.passwordHash) || user.status === 'SUSPENDED' || user.role !== 'SUPERADMIN') {
    logAuthEvent('LOGIN_FAILED', { ip, meta: { interface: 'superadmin', identifierType: identifier.includes('@') ? 'email' : 'mobile' } });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const purpose = user.status === 'PENDING' ? 'SIGNUP_VERIFY' : 'LOGIN_VERIFY';
  await setPendingAuth({ userId: user.id, purpose });
  logAuthEvent('LOGIN_SUCCESS', { userId: user.id, ip, purpose, meta: { interface: 'superadmin' } });

  return NextResponse.json({
    success: true,
    purpose,
    channels: { email: maskEmail(user.email), whatsapp: user.mobile ? maskMobile(user.mobile) : null },
  });
}
