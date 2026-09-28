import { NextRequest, NextResponse } from 'next/server';
import { createPendingUser, findUserByEmail, findUserByMobile } from '@/lib/auth/users';
import { hashPassword } from '@/lib/auth/password';
import { maskEmail, maskMobile } from '@/lib/auth/mobile';
import { setPendingAuth } from '@/lib/auth/pending-auth';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { signupSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(`signup:ip:${ip}`, 10, 3600))) {
    return NextResponse.json({ error: 'Too many signup attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { name, email, mobile, password } = parsed.data;

  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }
  if (await findUserByMobile(mobile)) {
    return NextResponse.json({ error: 'An account with this mobile number already exists.' }, { status: 409 });
  }

  // The findUserByEmail/findUserByMobile checks above aren't atomic with
  // this insert — two concurrent signups for the same email can both pass
  // them. The DB's UNIQUE constraints (users.email, users.mobile) are the
  // real backstop; catch the resulting Postgres error (23505) here and
  // report it the same way as the pre-check, instead of a raw 500.
  let user;
  try {
    user = await createPendingUser(name, email, mobile, hashPassword(password));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const detail = 'detail' in error && typeof error.detail === 'string' ? error.detail : '';
      const field = detail.includes('email') ? 'email' : detail.includes('mobile') ? 'mobile number' : 'email or mobile number';
      return NextResponse.json({ error: `An account with this ${field} already exists.` }, { status: 409 });
    }
    throw error;
  }
  logAuthEvent('SIGNUP_SUCCESS', { userId: user.id, ip });

  // Account stays PENDING (cannot log in) until SIGNUP_VERIFY OTP succeeds —
  // no session is created here.
  await setPendingAuth({ userId: user.id, purpose: 'SIGNUP_VERIFY' });

  return NextResponse.json({
    success: true,
    purpose: 'SIGNUP_VERIFY',
    channels: { email: maskEmail(user.email), whatsapp: maskMobile(user.mobile as string) },
  });
}
