// Durable idempotency, backed by publish_attempts' UNIQUE(platform, attempt_id)
// constraint (see src/lib/db.ts migration) — a real upgrade over the
// monolith's in-memory Map, which every provider route's own comment
// admits is "single-instance only; a restart clears the registry". This
// matters specifically because the task ahead (scheduler-service) must
// never double-publish across a crash/restart, which an in-memory guard
// cannot promise.
//
// Reservation pattern: claimAttempt() inserts a placeholder row FIRST,
// before calling any provider API. A unique-violation on that insert means
// this exact (platform, attemptId) was already claimed — reject as
// duplicate before any outbound call happens, not after. recordResult()
// then updates that row with the real outcome.

import { randomUUID } from 'node:crypto';

export function createIdempotencyStore(pool) {
  return {
    // Returns { duplicate: true } if this (platform, attemptId) was already
    // claimed (by a prior attempt or a concurrent one) — the caller must
    // not publish. Returns { duplicate: false, id } to proceed.
    async claimAttempt({ attemptId, platform, userId, destination }) {
      const id = randomUUID();
      try {
        await pool.query(
          `INSERT INTO publish_attempts (id, attempt_id, platform, user_id, destination, status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'FAILED', $6)`,
          [id, attemptId, platform, userId || null, destination || null, new Date().toISOString()],
        );
        return { duplicate: false, id };
      } catch (err) {
        // Postgres unique_violation
        if (err && err.code === '23505') return { duplicate: true };
        throw err;
      }
    },

    async recordResult(id, { status, providerPostId, errorCode }) {
      await pool.query(
        `UPDATE publish_attempts SET status = $2, provider_post_id = $3, error_code = $4 WHERE id = $1`,
        [id, status, providerPostId || null, errorCode || null],
      );
    },
  };
}
