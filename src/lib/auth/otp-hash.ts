import 'server-only';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

// Separate from SESSION_SECRET on purpose — different blast radius (this key
// only ever protects 6-digit, 5-minute-lived codes; rotating it just voids
// in-flight OTP challenges, not every logged-in session).
function getOtpSecret(): string {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret) {
    throw new Error('OTP_HASH_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.');
  }
  return secret;
}

export function generateOtp(length = 6): string {
  // crypto.randomInt is uniform over [0, 10^length) — no Math.random, no
  // modulo bias. Left-pad so e.g. 731 -> "000731".
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

// Keyed hash (HMAC), not a plain digest: knowing otp_hash alone can't be
// brute-forced offline without the server-side secret, on top of the
// expiry/attempt-limit protections. challengeId is bound in so the same
// 6-digit value never hashes the same way across two challenges.
export function hashOtp(otp: string, challengeId: string): string {
  return createHmac('sha256', getOtpSecret()).update(`${challengeId}:${otp}`).digest('hex');
}

export function verifyOtpHash(otp: string, challengeId: string, storedHash: string): boolean {
  const expected = Buffer.from(hashOtp(otp, challengeId), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
