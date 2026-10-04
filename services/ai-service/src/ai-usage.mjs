// Faithful port of src/lib/ai-usage.ts#recordAiUsage — same table
// (ai_usage_log, already owned/read by analytics-service). Fire-and-forget,
// same as the original: a lost usage row must never fail or delay the
// actual generation request.
import { randomUUID } from 'node:crypto';

export function createUsageRecorder(pool) {
  return function recordAiUsage({ type, provider, success, durationMs, userId }) {
    pool.query(
      'INSERT INTO ai_usage_log (id, user_id, type, provider, success, duration_ms, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [randomUUID(), userId ?? null, type, provider, success, durationMs ?? null, new Date().toISOString()],
    ).catch((error) => {
      console.error('[ai-usage] failed to record usage:', error instanceof Error ? error.message : 'unknown error');
    });
  };
}
