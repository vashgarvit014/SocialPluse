// Faithful port of src/lib/moderation-escalation.ts PLUS the inline SQL
// from src/app/api/superadmin/moderation/users/[id]/route.ts's POST switch
// (clear-flag/reset-counter/suspend/reactivate) — user-service is now the
// single owner of both the write path (ai-service's escalation calls) and
// the admin action path (admin-service's Superadmin calls) for this data,
// which the original code had split across two files touching the same
// columns. Same FOR UPDATE transaction, same threshold logic, copied
// verbatim — never auto-bans, suspension stays a deliberate Superadmin
// action.
import { randomUUID } from 'node:crypto';

export const FLAG_THRESHOLD = 2;
export const FLAG_REASON = 'REPEATED_PROHIBITED_SEXUAL_CONTENT';

export function severityForCount(count) {
  if (count >= 5) return 'CRITICAL';
  if (count >= 3) return 'HIGH';
  return 'WARNING';
}

function categoryFor(decision) {
  if (decision === 'BLOCK_NUDITY') return 'NUDITY';
  if (decision === 'BLOCK_EXPLICIT_SEXUAL') return 'EXPLICIT_SEXUAL';
  if (decision === 'BLOCK_OTHER_SAFETY') return 'OTHER_SAFETY';
  return 'NONE';
}

export function createModerationStore(pool) {
  return {
    // Called by ai-service after every non-ALLOW moderation decision.
    // admin_notifications insert is kept INSIDE this same transaction
    // (not split into a separate call to admin-service) deliberately: the
    // brief allows notification creation to "still go to admin-service",
    // but that is a non-mandatory allowance, not a requirement, and
    // splitting it into a second network call would reintroduce exactly
    // the race the FOR UPDATE lock exists to prevent (and risk a partial
    // write — counter updated, notification lost — if that second call
    // failed). Atomicity was judged the safer choice.
    async recordModerationDecision(result, input) {
      const countsAsViolation = result.countsAsViolation;
      const now = new Date().toISOString();

      const client = await pool.connect();
      let outcome;
      try {
        await client.query('BEGIN');
        const userRes = await client.query('SELECT id, moderation_violation_count, moderation_flagged FROM users WHERE id = $1 FOR UPDATE', [input.userId]);
        const user = userRes.rows[0];
        if (!user) throw new Error('User not found');

        const previousCount = Number(user.moderation_violation_count || 0);
        const count = countsAsViolation ? previousCount + 1 : previousCount;
        const severity = countsAsViolation ? severityForCount(count) : 'WARNING';
        const newlyFlagged = countsAsViolation && count >= FLAG_THRESHOLD && !user.moderation_flagged;
        const flagged = user.moderation_flagged || (countsAsViolation && count >= FLAG_THRESHOLD);

        if (countsAsViolation) {
          await client.query(
            `UPDATE users SET moderation_violation_count = $2, moderation_flagged = $3,
                moderation_flag_reason = CASE WHEN $3 THEN $4 ELSE moderation_flag_reason END,
                moderation_flagged_at = CASE WHEN $3 AND moderation_flagged_at IS NULL THEN $5 ELSE moderation_flagged_at END,
                moderation_first_violation_at = COALESCE(moderation_first_violation_at, $5),
                moderation_last_violation_at = $5
              WHERE id = $1`,
            [input.userId, count, flagged, FLAG_REASON, now],
          );
        }

        const eventId = randomUUID();
        await client.query(
          `INSERT INTO moderation_events (id, user_id, category, decision, action, severity, method, provider, counts_as_violation, violation_count_after, prompt_fingerprint, safe_metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [eventId, input.userId, categoryFor(result.decision), result.decision, input.action, countsAsViolation ? severity : 'INFO', result.method, input.provider ?? null, countsAsViolation, countsAsViolation ? count : previousCount, input.promptFingerprint ?? null, JSON.stringify({ ...(input.safeMetadata || {}), reason: input.reason ?? null }), now],
        );

        let notificationId = null;
        if (newlyFlagged || (countsAsViolation && count > FLAG_THRESHOLD)) {
          notificationId = randomUUID();
          await client.query(
            `INSERT INTO admin_notifications (id, type, category, severity, title, message, user_id, is_read, metadata, created_at)
             VALUES ($1,$2,'MODERATION',$3,$4,$5,$6,false,$7,$8)`,
            [
              notificationId, newlyFlagged ? 'USER_FLAGGED' : 'USER_MODERATION_ESCALATION', severity,
              newlyFlagged ? 'User account flagged' : `User account violation #${count}`,
              newlyFlagged ? `${input.reason || 'Repeated prohibited-content requests'} — account flagged for review (${count} confirmed attempts).` : `Violation #${count} (${severity}) on a flagged account.`,
              input.userId, JSON.stringify({ violationCount: count, method: result.method, decision: result.decision }), now,
            ],
          );
        }

        await client.query('COMMIT');
        outcome = { eventId, count, flagged, newlyFlagged, severity, notificationId, showWarning: result.decision !== 'ALLOW' };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return outcome;
    },

    // Read model for the Superadmin user detail + moderation table —
    // identical shape to moderation-escalation.ts#getUserModerationSummary.
    async getUserModerationSummary(userId) {
      const userRes = await pool.query(
        `SELECT moderation_violation_count, moderation_flagged, moderation_flag_reason,
                moderation_flagged_at, moderation_first_violation_at, moderation_last_violation_at
           FROM users WHERE id = $1`,
        [userId],
      );
      const user = userRes.rows[0];
      const latestRes = await pool.query(
        `SELECT decision, method, created_at FROM moderation_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      const latest = latestRes.rows[0];
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
    },

    // Superadmin action dispatch — exact same four actions and SQL as
    // superadmin/moderation/users/[id]/route.ts's POST switch. Note this
    // suspend/reactivate DOES bump session_version (unlike setUserStatus
    // in users.mjs) — preserved faithfully as a pre-existing inconsistency
    // in the original code, not something this port should silently fix.
    async applyModerationAction(userId, action) {
      const now = new Date().toISOString();
      switch (action) {
        case 'clear-flag': {
          const { rows } = await pool.query(
            `UPDATE users SET moderation_flagged = false, moderation_flag_reason = NULL,
                    moderation_flagged_at = NULL, updated_at = $2
              WHERE id = $1 AND moderation_flagged = true RETURNING id`,
            [userId, now],
          );
          return { success: true, cleared: rows.length > 0 };
        }
        case 'reset-counter': {
          await pool.query(
            `UPDATE users SET moderation_violation_count = 0, moderation_flagged = false,
                    moderation_flag_reason = NULL, moderation_flagged_at = NULL,
                    moderation_first_violation_at = NULL, moderation_last_violation_at = NULL,
                    updated_at = $2
              WHERE id = $1 RETURNING id`,
            [userId, now],
          );
          return { success: true };
        }
        case 'suspend': {
          await pool.query(
            `UPDATE users SET status = 'SUSPENDED', session_version = session_version + 1, updated_at = $2
              WHERE id = $1 RETURNING id`,
            [userId, now],
          );
          return { success: true, status: 'SUSPENDED' };
        }
        case 'reactivate': {
          await pool.query(
            `UPDATE users SET status = 'ACTIVE', session_version = session_version + 1, updated_at = $2
              WHERE id = $1 RETURNING id`,
            [userId, now],
          );
          return { success: true, status: 'ACTIVE' };
        }
        default:
          return { error: 'Unknown moderation action.' };
      }
    },
  };
}
