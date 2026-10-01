import 'server-only';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@/lib/db';
import { logSystem } from '@/lib/system-log';
import type { ModerationDecision, ModerationMethod, ModerationResult } from '@/lib/moderation';

// Escalation for repeated prohibited-content attempts.
//
// The whole escalation is ONE transaction: log the event, increment the
// counter, decide whether this crosses the flag threshold, write the flag, and
// queue the admin notification. Doing these as separate statements lets two
// simultaneous requests both read count=1 and both decide "not the second one
// yet", so an account that trips the threshold twice in the same second would
// never get flagged.

/** Violation count at which an account is flagged for review. */
export const FLAG_THRESHOLD = 2;
export const FLAG_REASON = 'REPEATED_PROHIBITED_SEXUAL_CONTENT';

/**
 * Admin severity from the running count.
 *
 *   1        WARNING   (warned, not yet flagged)
 *   2        WARNING   (flagged)
 *   3-4      HIGH
 *   5+       CRITICAL
 *
 * Never auto-bans. Suspension is a deliberate Superadmin action, because an
 * irreversible automated response to a possibly-wrong classification would be
 * far worse than the thing it is protecting against.
 */
export function severityForCount(count: number): 'WARNING' | 'HIGH' | 'CRITICAL' {
  if (count >= 5) return 'CRITICAL';
  if (count >= 3) return 'HIGH';
  return 'WARNING';
}

export interface EscalationOutcome {
  eventId: string;
  count: number;
  flagged: boolean;
  newlyFlagged: boolean;
  severity: 'WARNING' | 'HIGH' | 'CRITICAL';
  notificationId: string | null;
  /** What the caller must show the user. */
  showWarning: boolean;
}

export interface RecordInput {
  userId: string;
  decision: ModerationDecision;
  method: ModerationMethod;
  action: string;
  provider?: string | null;
  reason?: string;
  /** Non-reversible prompt fingerprint. Never the prompt text. */
  promptFingerprint?: string | null;
  /** Extra safe, non-identifying metadata for the audit trail. */
  safeMetadata?: Record<string, string | number | boolean | null>;
}

/**
 * Records a moderation decision and applies escalation if warranted.
 *
 * Only `countsAsViolation` decisions advance the counter. An ALLOW is not
 * recorded here at all (it would be noise); a BLOCK_OTHER_SAFETY is recorded
 * but does not count, so unrelated safety refusals never accumulate against an
 * account's nudity history.
 */
export async function recordModerationDecision(result: ModerationResult, input: RecordInput): Promise<EscalationOutcome> {
  const countsAsViolation = result.countsAsViolation;
  const now = new Date().toISOString();

  const outcome = await withTransaction(async (tx) => {
    // Lock the user row. Without FOR UPDATE two concurrent violations for the
    // same account can both read the same counter and one increment is lost.
    const user = await tx.queryOne<{
      id: string;
      moderation_violation_count: number;
      moderation_flagged: boolean;
    }>(
      `SELECT id, moderation_violation_count, moderation_flagged
         FROM users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    if (!user) throw new Error('User not found');

    const previousCount = Number(user.moderation_violation_count || 0);
    const count = countsAsViolation ? previousCount + 1 : previousCount;
    const severity = countsAsViolation ? severityForCount(count) : 'WARNING';
    const newlyFlagged = countsAsViolation && count >= FLAG_THRESHOLD && !user.moderation_flagged;
    const flagged = user.moderation_flagged || (countsAsViolation && count >= FLAG_THRESHOLD);

    if (countsAsViolation) {
      await tx.query(
        `UPDATE users
            SET moderation_violation_count = $2,
                moderation_flagged = $3,
                moderation_flag_reason = CASE WHEN $3 THEN $4 ELSE moderation_flag_reason END,
                moderation_flagged_at = CASE WHEN $3 AND moderation_flagged_at IS NULL THEN $5 ELSE moderation_flagged_at END,
                moderation_first_violation_at = COALESCE(moderation_first_violation_at, $5),
                moderation_last_violation_at = $5
          WHERE id = $1`,
        [input.userId, count, flagged, FLAG_REASON, now],
      );
    }

    const eventId = randomUUID();
    await tx.query(
      `INSERT INTO moderation_events
         (id, user_id, category, decision, action, severity, method, provider,
          counts_as_violation, violation_count_after, prompt_fingerprint, safe_metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        eventId,
        input.userId,
        categoryFor(result.decision),
        result.decision,
        input.action,
        countsAsViolation ? severity : 'INFO',
        result.method,
        input.provider ?? null,
        countsAsViolation,
        countsAsViolation ? count : previousCount,
        input.promptFingerprint ?? null,
        JSON.stringify({ ...(input.safeMetadata || {}), reason: input.reason ?? null }),
        now,
      ],
    );

    let notificationId: string | null = null;
    // A notification on EVERY violation would drown the admin queue, so the
    // first one is a warning and every violation from the flag threshold on is
    // raised — each new occurrence is something an admin should see, because
    // the account is under review.
    if (newlyFlagged || (countsAsViolation && count > FLAG_THRESHOLD)) {
      notificationId = randomUUID();
      await tx.query(
        `INSERT INTO admin_notifications
           (id, type, category, severity, title, message, user_id, is_read, metadata, created_at)
         VALUES ($1,$2,'MODERATION',$3,$4,$5,$6,false,$7,$8)`,
        [
          notificationId,
          newlyFlagged ? 'USER_FLAGGED' : 'USER_MODERATION_ESCALATION',
          severity,
          newlyFlagged ? 'User account flagged' : `User account violation #${count}`,
          newlyFlagged
            ? `${input.reason || 'Repeated prohibited-content requests'} — account flagged for review (${count} confirmed attempts).`
            : `Violation #${count} (${severity}) on a flagged account.`,
          input.userId,
          JSON.stringify({ violationCount: count, method: result.method, decision: result.decision }),
          now,
        ],
      );
    }

    return { eventId, count, flagged, newlyFlagged, severity, notificationId, showWarning: result.decision !== 'ALLOW' };
  });

  // Audit logging happens after the commit: a failed log line must never
  // roll back a legitimate escalation, and never delays the user's response.
  if (result.decision !== 'ALLOW') {
    logSystem({
      level: outcome.count >= FLAG_THRESHOLD ? 'WARN' : 'INFO',
      category: 'SYSTEM',
      event: 'CONTENT_MODERATION_BLOCKED',
      userId: input.userId,
      message: `Blocked image generation: ${result.decision}`,
      metadata: {
        decision: result.decision,
        method: result.method,
        violationCount: outcome.count,
        severity: outcome.severity,
      },
    });
    logSystem({
      level: 'INFO', category: 'SYSTEM', event: 'CONTENT_SAFETY_WARNING_ISSUED',
      userId: input.userId,
      message: `Content safety warning issued (violation #${outcome.count})`,
      metadata: { decision: result.decision, violationCount: outcome.count },
    });
    if (outcome.newlyFlagged) {
      logSystem({
        level: 'WARN', category: 'SYSTEM', event: 'USER_MODERATION_FLAGGED',
        userId: input.userId,
        message: `Account flagged after ${outcome.count} confirmed prohibited-content attempts`,
        metadata: { reason: FLAG_REASON, violationCount: outcome.count, notificationId: outcome.notificationId },
      });
    }
  }

  return outcome;
}

function categoryFor(decision: ModerationDecision): string {
  if (decision === 'BLOCK_NUDITY') return 'NUDITY';
  if (decision === 'BLOCK_EXPLICIT_SEXUAL') return 'EXPLICIT_SEXUAL';
  if (decision === 'BLOCK_OTHER_SAFETY') return 'OTHER_SAFETY';
  return 'NONE';
}

export interface ModerationSummary {
  violationCount: number;
  flagged: boolean;
  flagReason: string | null;
  flaggedAt: string | null;
  firstViolationAt: string | null;
  lastViolationAt: string | null;
  latestDecision: string | null;
  latestMethod: string | null;
  latestEventAt: string | null;
}

/** Read model for the Superadmin user detail + moderation table. */
export async function getUserModerationSummary(userId: string): Promise<ModerationSummary> {
  const { queryOne } = await import('@/lib/db');
  const user = await queryOne<{
    moderation_violation_count: number;
    moderation_flagged: boolean;
    moderation_flag_reason: string | null;
    moderation_flagged_at: string | null;
    moderation_first_violation_at: string | null;
    moderation_last_violation_at: string | null;
  }>(
    `SELECT moderation_violation_count, moderation_flagged, moderation_flag_reason,
            moderation_flagged_at, moderation_first_violation_at, moderation_last_violation_at
       FROM users WHERE id = $1`,
    [userId],
  );
  const latest = await queryOne<{ decision: string; method: string; created_at: string }>(
    `SELECT decision, method, created_at FROM moderation_events
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return {
    violationCount: Number(user?.moderation_violation_count || 0),
    flagged: !!user?.moderation_flagged,
    flagReason: user?.moderation_flag_reason || null,
    flaggedAt: user?.moderation_flagged_at || null,
    firstViolationAt: user?.moderation_first_violation_at || null,
    lastViolationAt: user?.moderation_last_violation_at || null,
    latestDecision: latest?.decision || null,
    latestMethod: latest?.method || null,
    latestEventAt: latest?.created_at || null,
  };
}

/** Clears a flag. Moderation must never be irreversible — classifiers err. */
export async function clearModerationFlag(userId: string): Promise<{ cleared: boolean }> {
  const { query } = await import('@/lib/db');
  const rows = await query<{ id: string }>(
    `UPDATE users SET moderation_flagged = false, moderation_flag_reason = NULL,
            moderation_flagged_at = NULL, updated_at = $2
      WHERE id = $1 AND moderation_flagged = true RETURNING id`,
    [userId, new Date().toISOString()],
  );
  const cleared = rows.length > 0;
  if (cleared) {
    logSystem({
      level: 'INFO', category: 'SYSTEM', event: 'MODERATION_FLAG_CLEARED', userId,
      message: 'Moderation flag cleared by Superadmin',
    });
  }
  return { cleared };
}