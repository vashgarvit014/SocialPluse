import { NextRequest, NextResponse } from 'next/server';
import { findUserByIdentifier } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { maskEmail, maskMobile } from '@/lib/auth/mobile';
import { setPendingAuth } from '@/lib/auth/pending-auth';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { loginSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';

const GENERIC_ERROR = 'Invalid email/mobile or password.';

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(`login:ip:${ip}`, 20, 3600))) {
    return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  // Format validation only (is this shaped like an email or a mobile
  // number at all?) — a distinct, safe 400 that reveals nothing about
  // account existence. Actual credential mismatches below stay the one
  // generic 401 regardless of identifier type or which part was wrong.
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { identifier, password } = parsed.data;

  if (!(await checkRateLimit(`login:identifier:${identifier.toLowerCase()}`, 10, 3600))) {
    return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
  }

  const user = await findUserByIdentifier(identifier);
  // Never distinguish "no such account" from "wrong password" to the client.
  if (!user || !verifyPassword(password, user.passwordHash) || user.status === 'SUSPENDED') {
    logAuthEvent('LOGIN_FAILED', { ip, meta: { identifierType: identifier.includes('@') ? 'email' : 'mobile' } });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  // Password alone is not enough — every login (and any signup that never
  // finished verifying) still needs an OTP before a session is created.
  const purpose = user.status === 'PENDING' ? 'SIGNUP_VERIFY' : 'LOGIN_VERIFY';
  await setPendingAuth({ userId: user.id, purpose });

  return NextResponse.json({
    success: true,
    purpose,
    channels: { email: maskEmail(user.email), whatsapp: user.mobile ? maskMobile(user.mobile) : null },
  });
}
