import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { OtpPurpose } from './otp';

// Short-lived, separate from the real session cookie: set once
// email/mobile+password (or, for forgot-password, just the identifier) has
// been validated, and cleared the moment OTP verification resolves either
// way. Its mere presence proves nothing about account access — it only
// tells otp/request and otp/verify which user+purpose they're operating on,
// so the client can never request/verify an OTP for an account it hasn't
// just proven the password for.
const PENDING_AUTH_COOKIE = 'sp_pending_auth';
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000; // generous vs. the 5-min OTP TTL to cover one resend

function getEncodedKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set.');
  return new TextEncoder().encode(secret);
}

export interface PendingAuth {
  userId: string;
  purpose: OtpPurpose;
  // Only meaningful for PASSWORD_RESET: false while waiting on the OTP,
  // flipped to true (by re-issuing this cookie) once otp/verify succeeds —
  // that's what password/reset checks before allowing a new password, since
  // that flow doesn't create a real session at OTP-verify time.
  verified?: boolean;
}

export async function setPendingAuth(payload: PendingAuth): Promise<void> {
  const token = await new SignJWT({ ...payload, typ: 'pending_auth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + PENDING_AUTH_TTL_MS) / 1000))
    .sign(getEncodedKey());

  const cookieStore = await cookies();
  cookieStore.set(PENDING_AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: PENDING_AUTH_TTL_MS / 1000,
    path: '/',
  });
}

export async function getPendingAuth(): Promise<PendingAuth | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PENDING_AUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getEncodedKey(), { algorithms: ['HS256'] });
    if (payload.typ !== 'pending_auth' || typeof payload.userId !== 'string' || typeof payload.purpose !== 'string') return null;
    return { userId: payload.userId, purpose: payload.purpose as OtpPurpose, verified: payload.verified === true };
  } catch {
    return null;
  }
}

export async function clearPendingAuth(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PENDING_AUTH_COOKIE);
}
