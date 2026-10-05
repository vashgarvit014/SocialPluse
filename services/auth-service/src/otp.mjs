// Faithful port of src/lib/auth/otp.ts.
import { randomUUID } from 'node:crypto';
import { generateOtp, hashOtp, verifyOtpHash } from './otp-hash.mjs';

export const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_TTL_MINUTES = OTP_TTL_MS / 60_000;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
export { RESEND_COOLDOWN_MS };

export function createOtpStore(pool) {
  async function getRow(challengeId) {
    const { rows } = await pool.query('SELECT * FROM otp_challenges WHERE id = $1', [challengeId]);
    return rows[0] || null;
  }
  async function invalidate(challengeId) {
    await pool.query('UPDATE otp_challenges SET invalidated_at = $1 WHERE id = $2 AND invalidated_at IS NULL', [new Date().toISOString(), challengeId]);
  }

  return {
    // Returns the plaintext OTP alongside the challenge — ONLY the delivery
    // layer may read `otp` off this. Never persisted, never logged, never
    // returned from an API route.
    async createChallenge({ userId, channel, destination, purpose }) {
      const id = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
      const otp = generateOtp(OTP_LENGTH);
      const otpHash = hashOtp(otp, id);

      // Only one active challenge per user+purpose at a time.
      await pool.query(`
        UPDATE otp_challenges SET invalidated_at = $1
        WHERE user_id = $2 AND purpose = $3 AND verified_at IS NULL AND invalidated_at IS NULL
      `, [now.toISOString(), userId, purpose]);

      await pool.query(`
        INSERT INTO otp_challenges
          (id, user_id, destination, channel, purpose, otp_hash, expires_at, attempt_count, max_attempts, resend_count, max_resends, last_sent_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, 0, $9, $10, $10)
      `, [id, userId, destination, channel, purpose, otpHash, expiresAt.toISOString(), MAX_ATTEMPTS, MAX_RESENDS, now.toISOString()]);

      return {
        challenge: { challengeId: id, expiresAt: expiresAt.toISOString(), resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS).toISOString() },
        otp,
      };
    },

    // Single use: a successful verify immediately invalidates the challenge.
    async verifyChallenge(challengeId, otp) {
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
        await pool.query('UPDATE otp_challenges SET attempt_count = $1 WHERE id = $2', [nextCount, challengeId]);
        if (nextCount >= row.max_attempts) await invalidate(challengeId);
        return { ok: false, reason: nextCount >= row.max_attempts ? 'too_many_attempts' : 'incorrect' };
      }
      const now = new Date().toISOString();
      await pool.query('UPDATE otp_challenges SET verified_at = $1, invalidated_at = $1 WHERE id = $2', [now, challengeId]);
      return { ok: true, userId: row.user_id, purpose: row.purpose, channel: row.channel, destination: row.destination };
    },

    // Rotates in place: same challengeId, brand-new code, attempts reset,
    // old code stops working immediately.
    async resendChallenge(challengeId) {
      const row = await getRow(challengeId);
      if (!row) return { ok: false, reason: 'not_found' };
      if (row.verified_at || row.invalidated_at) return { ok: false, reason: 'invalid' };
      const sinceLastSent = Date.now() - new Date(row.last_sent_at).getTime();
      if (sinceLastSent < RESEND_COOLDOWN_MS) return { ok: false, reason: 'cooldown', retryAfterMs: RESEND_COOLDOWN_MS - sinceLastSent };
      if (row.resend_count >= row.max_resends) {
        await invalidate(challengeId);
        return { ok: false, reason: 'limit' };
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
      const otp = generateOtp(OTP_LENGTH);
      const otpHash = hashOtp(otp, challengeId);
      await pool.query(`
        UPDATE otp_challenges
        SET otp_hash = $1, expires_at = $2, attempt_count = 0, resend_count = resend_count + 1, last_sent_at = $3
        WHERE id = $4
      `, [otpHash, expiresAt.toISOString(), now.toISOString(), challengeId]);
      return {
        ok: true, otp, channel: row.channel, destination: row.destination, purpose: row.purpose,
        resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS).toISOString(), expiresAt: expiresAt.toISOString(),
      };
    },

    async invalidateChallenge(challengeId) {
      await invalidate(challengeId);
    },

    async getChallengeOwner(challengeId) {
      const row = await getRow(challengeId);
      if (!row || row.verified_at || row.invalidated_at) return null;
      return { userId: row.user_id, purpose: row.purpose };
    },

    // The one challenge a user could still successfully submit against.
    // createChallenge() invalidates any earlier un-verified challenge for the
    // same user+purpose, so this is what a repeat request must NOT clobber.
    async findActiveChallenge({ userId, purpose }) {
      const { rows } = await pool.query(
        `SELECT * FROM otp_challenges
          WHERE user_id = $1 AND purpose = $2
            AND verified_at IS NULL AND invalidated_at IS NULL
            AND expires_at > $3
          ORDER BY created_at DESC LIMIT 1`,
        [userId, purpose, new Date().toISOString()],
      );
      return rows[0] || null;
    },
  };
}
