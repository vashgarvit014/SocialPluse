import 'server-only';
import { randomUUID } from 'node:crypto';
import { query, queryOne, type OtpChallengeRow } from '@/lib/db';
import { generateOtp, hashOtp, verifyOtpHash } from './otp-hash';

// Purpose is reusable beyond SIGNUP_VERIFY/LOGIN_VERIFY/PASSWORD_RESET — the
// engine itself has no purpose-specific logic, so EMAIL_CHANGE/MOBILE_CHANGE
// slot in later without touching this file.
export type OtpPurpose = 'SIGNUP_VERIFY' | 'LOGIN_VERIFY' | 'PASSWORD_RESET' | 'EMAIL_CHANGE' | 'MOBILE_CHANGE';
export type OtpChannel = 'EMAIL' | 'WHATSAPP';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_TTL_MINUTES = OTP_TTL_MS / 60_000;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

export interface Challenge {
  challengeId: string;
  expiresAt: string;
  resendAvailableAt: string;
}

// Returns the plaintext OTP alongside the challenge — ONLY the delivery
// layer (email/WhatsApp adapters) may read `otp` off this. Never persisted,
// never logged, never returned from an API route.
export async function createChallenge(params: {
  userId: string;
  channel: OtpChannel;
  destination: string;
  purpose: OtpPurpose;
}): Promise<{ challenge: Challenge; otp: string }> {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  const otp = generateOtp(OTP_LENGTH);
  const otpHash = hashOtp(otp, id);

  // Only one active (unverified, uninvalidated) challenge per user+purpose
  // at a time — starting a fresh one (e.g. switching channel, or a second
  // /otp/request before finishing the first) retires whatever came before it.
  await query(`
    UPDATE otp_challenges SET invalidated_at = $1
    WHERE user_id = $2 AND purpose = $3 AND verified_at IS NULL AND invalidated_at IS NULL
  `, [now.toISOString(), params.userId, params.purpose]);

  await query(`
    INSERT INTO otp_challenges
      (id, user_id, destination, channel, purpose, otp_hash, expires_at, attempt_count, max_attempts, resend_count, max_resends, last_sent_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, 0, $9, $10, $10)
  `, [id, params.userId, params.destination, params.channel, params.purpose, otpHash, expiresAt.toISOString(), MAX_ATTEMPTS, MAX_RESENDS, now.toISOString()]);

  return {
    challenge: { challengeId: id, expiresAt: expiresAt.toISOString(), resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS).toISOString() },
    otp,
  };
}

function getRow(challengeId: string): Promise<OtpChallengeRow | null> {
  return queryOne<OtpChallengeRow>('SELECT * FROM otp_challenges WHERE id = $1', [challengeId]);
}

async function invalidate(challengeId: string) {
  await query('UPDATE otp_challenges SET invalidated_at = $1 WHERE id = $2 AND invalidated_at IS NULL', [new Date().toISOString(), challengeId]);
}

export type VerifyResult =
  | { ok: true; userId: string; purpose: OtpPurpose; channel: OtpChannel; destination: string }
  | { ok: false; reason: 'not_found' | 'invalid' | 'expired' | 'too_many_attempts' | 'incorrect' };

// Single use: a successful verify immediately invalidates the challenge too,
// so the same code can never be replayed.
export async function verifyChallenge(challengeId: string, otp: string): Promise<VerifyResult> {
  const row = await getRow(challengeId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.verified_at || row.invalidated_at) return { ok: false, reason: 'invalid' };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await invalidate(challengeId);
    return { ok: false, reason: 'expired' };
  }
  if (row.attempt_count >= row.max_attempts) {
    await invalidate(challengeId);
    return { ok: false, reason: 'too_many_attempts' };
  }

  if (!verifyOtpHash(otp, challengeId, row.otp_hash)) {
    const nextCount = row.attempt_count + 1;
    await query('UPDATE otp_challenges SET attempt_count = $1 WHERE id = $2', [nextCount, challengeId]);
    if (nextCount >= row.max_attempts) await invalidate(challengeId);
    return { ok: false, reason: nextCount >= row.max_attempts ? 'too_many_attempts' : 'incorrect' };
  }

  const now = new Date().toISOString();
  await query('UPDATE otp_challenges SET verified_at = $1, invalidated_at = $1 WHERE id = $2', [now, challengeId]);
  return { ok: true, userId: row.user_id, purpose: row.purpose as OtpPurpose, channel: row.channel as OtpChannel, destination: row.destination };
}

export type ResendResult =
  | { ok: true; otp: string; channel: OtpChannel; destination: string; purpose: OtpPurpose; resendAvailableAt: string }
  | { ok: false; reason: 'not_found' | 'invalid' | 'cooldown' | 'limit'; retryAfterMs?: number };

// Rotates in place: same challengeId, brand-new code, attempts reset, old
// code stops working immediately — never re-sends the previous OTP.
export async function resendChallenge(challengeId: string): Promise<ResendResult> {
  const row = await getRow(challengeId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.verified_at || row.invalidated_at) return { ok: false, reason: 'invalid' };

  const sinceLastSent = Date.now() - new Date(row.last_sent_at).getTime();
  if (sinceLastSent < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown', retryAfterMs: RESEND_COOLDOWN_MS - sinceLastSent };
  }
  if (row.resend_count >= row.max_resends) {
    await invalidate(challengeId);
    return { ok: false, reason: 'limit' };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  const otp = generateOtp(OTP_LENGTH);
  const otpHash = hashOtp(otp, challengeId);

  await query(`
    UPDATE otp_challenges
    SET otp_hash = $1, expires_at = $2, attempt_count = 0, resend_count = resend_count + 1, last_sent_at = $3
    WHERE id = $4
  `, [otpHash, expiresAt.toISOString(), now.toISOString(), challengeId]);

  return {
    ok: true,
    otp,
    channel: row.channel as OtpChannel,
    destination: row.destination,
    purpose: row.purpose as OtpPurpose,
    resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS).toISOString(),
  };
}

export async function invalidateChallenge(challengeId: string): Promise<void> {
  await invalidate(challengeId);
}

export async function getChallengeOwner(challengeId: string): Promise<{ userId: string; purpose: OtpPurpose } | null> {
  const row = await getRow(challengeId);
  if (!row || row.verified_at || row.invalidated_at) return null;
  return { userId: row.user_id, purpose: row.purpose as OtpPurpose };
}
