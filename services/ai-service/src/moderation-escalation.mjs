// Phase 8 (user-service extraction) changed this file from a direct
// `users`/`moderation_events` writer into a thin user-service client —
// user-service now owns that data (moderation_violation_count/flagged/
// flagReason/flaggedAt on `users`, plus `moderation_events`). Same public
// shape as before (`createModerationStore(pool).recordModerationDecision`)
// so server.mjs's two call sites needed no changes at all. `pool` is no
// longer used here but is kept as the parameter for that reason.
import { randomUUID } from 'node:crypto';
import { internalFetchHeaders } from '../packages/service-auth/index.mjs';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:4010';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

export function createModerationStore(_pool) {
  return {
    async recordModerationDecision(result, input) {
      const res = await fetch(`${USER_SERVICE_URL}/internal/users/${input.userId}/moderation/decision`, {
        method: 'POST',
        headers: internalFetchHeaders(INTERNAL_SECRET, randomUUID(), { 'content-type': 'application/json' }),
        body: JSON.stringify({
          decision: result.decision, method: result.method, countsAsViolation: result.countsAsViolation,
          action: input.action, provider: input.provider ?? null, reason: input.reason,
          promptFingerprint: input.promptFingerprint ?? null, safeMetadata: input.safeMetadata,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`user-service moderation decision call failed: ${res.status} ${body.error || body.message || 'unknown'}`);
      }
      return res.json();
    },
  };
}
