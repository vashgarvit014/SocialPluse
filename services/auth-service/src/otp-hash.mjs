// Faithful port of src/lib/auth/otp-hash.ts.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

function getOtpSecret() {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret) throw new Error('OTP_HASH_SECRET is not set.');
  return secret;
}

export function generateOtp(length = 6) {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

export function hashOtp(otp, challengeId) {
  return createHmac('sha256', getOtpSecret()).update(`${challengeId}:${otp}`).digest('hex');
}

export function verifyOtpHash(otp, challengeId, storedHash) {
  const expected = Buffer.from(hashOtp(otp, challengeId), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
