import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createPendingSuperadmin, findUserByEmail, findUserByMobile } from '@/lib/auth/users';
import { hashPassword } from '@/lib/auth/password';
import { maskEmail, maskMobile } from '@/lib/auth/mobile';
import { setPendingAuth } from '@/lib/auth/pending-auth';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';
import { nameSchema, emailSchema, mobileSchema, passwordSchema } from '@/lib/auth/schemas';
import { validationErrorResponse } from '@/lib/auth/validation-response';
import { z } from 'zod';

// Protected Superadmin self-signup (POST from /superadmin/signup only).
// The setup secret lives server-side only (SUPERADMIN_SETUP_SECRET — never
// NEXT_PUBLIC_*, never sent to the client). Compared with timingSafeEqual.
// If the env var is missing/empty, signup is disabled entirely (503) rather
// than ever falling back to open registration.
const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  mobile: mobileSchema,
  password: passwordSchema,
  setupSecret: z.string().min(1, 'Setup secret is required.'),
});

function setupSecretValid(provided: string): boolean {
  const expected = process.env.SUPERADMIN_SETUP_SECRET || '';
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(`ssignup:ip:${ip}`, 10, 3600))) {
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
  const { name, email, mobile, password, setupSecret } = parsed.data;

  // Generic message on purpose — must not reveal whether the secret exists.
  if (!setupSecretValid(setupSecret)) {
    logAuthEvent('SIGNUP_FAILED', { ip, meta: { interface: 'superadmin', reason: 'setup_secret' } });
    return NextResponse.json({ error: 'Invalid setup secret.' }, { status: 403 });
  }

  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }
  if (await findUserByMobile(mobile)) {
    return NextResponse.json({ error: 'An account with this mobile number already exists.' }, { status: 409 });
  }

  let user;
  try {
    user = await createPendingSuperadmin(name, email, mobile, hashPassword(password));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'An account with this email or mobile number already exists.' }, { status: 409 });
    }
    throw error;
  }
  logAuthEvent('SIGNUP_SUCCESS', { userId: user.id, ip, meta: { interface: 'superadmin' } });

  await setPendingAuth({ userId: user.id, purpose: 'SIGNUP_VERIFY' });

  return NextResponse.json({
    success: true,
    purpose: 'SIGNUP_VERIFY',
    channels: { email: maskEmail(user.email), whatsapp: maskMobile(user.mobile as string) },
  });
}
