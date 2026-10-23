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

// Flag-for-review threshold: 3 confirmed violations (spec tier "3rd
// confirmed violation -> flag account for Super Admin review"). Was 2
// before the Content Violation Monitoring feature; kept as a hardcoded
// const with a comment (matching this file's existing style) rather than
// an env var or DB-driven policy table — a 3-tier ladder doesn't need its
// own admin UI to be useful.
export const FLAG_THRESHOLD = 3;
export const FLAG_REASON = 'REPEATED_PROHIBITED_SEXUAL_CONTENT';

// Explicit 1st/2nd/3rd+ ladder for user-facing warning copy. count > 3
// still falls through to severityForCount()'s existing CRITICAL-at-5 rule.
export const ESCALATION_TIERS = [
  { atCount: 1, severity: 'WARNING', label: 'First warning' },
  { atCount: 2, severity: 'WARNING', label: 'Second warning (stronger)' },
  { atCount: 3, severity: 'HIGH', label: 'Flagged for review', flags: true },
];

export function warningCopyForCount(count) {
  if (count <= 1) return { title: 'Content Policy Violation Detected', tone: 'first' };
  if (count === 2) return { title: 'Content Policy Violation Detected — Second Warning', tone: 'stronger' };
  return { title: 'Content Policy Violation Detected — Account Flagged for Review', tone: 'flagged' };
}

export function severityForCount(count) {
  if (count >= 5) return 'CRITICAL';
  if (count >= 3) return 'HIGH';
  return 'WARNING';
}

// Default soft-delete retention for moderation_incidents. RESTRICTED_CSAM
// incidents are permanently exempt from automatic cleanup regardless of
// age — see cleanupExpiredIncidents() below.
export const INCIDENT_RETENTION_DAYS = 180;

function categoryFor(decision) {
  if (decision === 'BLOCK_NUDITY') return 'NUDITY';
  if (decision === 'BLOCK_EXPLICIT_SEXUAL') return 'EXPLICIT_SEXUAL';
  if (decision === 'BLOCK_SUGGESTIVE') return 'SUGGESTIVE';
  if (decision === 'BLOCK_MINOR_SEXUAL') return 'MINOR_SEXUAL';
  if (decision === 'NEEDS_CLARIFICATION') return 'UNCERTAIN';
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
    // input gains: source ('ASSET_GALLERY_UPLOAD'|'AI_GENERATION'|
    // 'DIRECT_PUBLISH'|'SCHEDULED_PUBLISH'), platform (nullable), idempotencyKey
    // (required when source is a publish/upload path — see pre-publish-check.mjs
    // and media-assets.mjs), contentPreview (optional, NEVER sent for
    // sexual/CSAM categories by callers), mediaAssetId (optional).
    async recordModerationDecision(result, input) {
      const countsAsViolation = result.countsAsViolation;
      const now = new Date().toISOString();
      const isUncertain = result.decision === 'NEEDS_CLARIFICATION';

      const client = await pool.connect();
      let outcome;
      try {
        await client.query('BEGIN');

        // Idempotency check FIRST, before touching the counter, the audit
        // log, or sending a notification — a retry of the same attempt must
        // be a true no-op across ALL of those, not just moderation_incidents.
        // (An earlier version only deduped the incidents table, which still
        // let a retried request double-count the violation and double-fire
        // the warning notification — caught by this file's own test suite,
        // tests/moderation-escalation-db.cjs, before it ever shipped.)
        if (input.idempotencyKey) {
          const existing = await client.query('SELECT id, violation_count_after, warning_notification_id FROM moderation_incidents WHERE idempotency_key = $1', [input.idempotencyKey]);
          if (existing.rows[0]) {
            await client.query('ROLLBACK');
            const userRes = await pool.query('SELECT moderation_violation_count, moderation_flagged FROM users WHERE id = $1', [input.userId]);
            const user = userRes.rows[0];
            return {
              eventId: null, incidentId: existing.rows[0].id,
              count: Number(user?.moderation_violation_count || 0), flagged: !!user?.moderation_flagged, newlyFlagged: false,
              severity: countsAsViolation ? severityForCount(Number(user?.moderation_violation_count || 0)) : 'WARNING',
              notificationId: existing.rows[0].warning_notification_id, showWarning: result.decision !== 'ALLOW', deduped: true,
            };
          }
        }

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

        // moderation_incidents: idempotent via ON CONFLICT DO NOTHING on
        // idempotency_key. A duplicate (retry of the same attempt) returns
        // zero rows here, and the notification insert below is skipped too
        // — the whole write becomes a no-op on retry, satisfying "no
        // duplicate incidents for repeated processing of the same event."
        let incidentId = null;
        let incidentCreated = false;
        if (input.idempotencyKey) {
          const incidentRes = await client.query(
            `INSERT INTO moderation_incidents (
               id, idempotency_key, user_id, source, platform, category, decision, status, confidence, method,
               content_excerpt_fingerprint, content_preview, media_asset_id, violation_count_after, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id`,
            [
              randomUUID(), input.idempotencyKey, input.userId, input.source, input.platform ?? null,
              categoryFor(result.decision), result.decision, isUncertain ? 'UNCERTAIN' : 'BLOCKED',
              result.confidence != null ? String(result.confidence) : null, result.method,
              input.promptFingerprint ?? null, input.contentPreview ?? null, input.mediaAssetId ?? null,
              countsAsViolation ? count : previousCount, now,
            ],
          );
          if (incidentRes.rows[0]) { incidentId = incidentRes.rows[0].id; incidentCreated = true; }
        }

        let notificationId = null;
        if (incidentCreated && (newlyFlagged || (countsAsViolation && count > FLAG_THRESHOLD) || isUncertain || countsAsViolation)) {
          notificationId = randomUUID();
          const warningCopy = warningCopyForCount(count);
          await client.query(
            `INSERT INTO admin_notifications (id, type, category, severity, title, message, user_id, is_read, metadata, created_at)
             VALUES ($1,$2,'MODERATION',$3,$4,$5,$6,false,$7,$8)`,
            [
              notificationId,
              isUncertain ? 'CONTENT_UNDER_REVIEW' : (newlyFlagged ? 'USER_FLAGGED' : 'USER_MODERATION_ESCALATION'),
              isUncertain ? 'INFO' : severity,
              isUncertain ? 'Content under review' : warningCopy.title,
              isUncertain
                ? "We couldn't automatically verify this content. It wasn't published."
                : (newlyFlagged
                  ? `${input.reason || 'Repeated prohibited-content requests'} — account flagged for review (${count} confirmed attempts).`
                  : `Violation #${count} (${severity}).`),
              input.userId,
              JSON.stringify({ violationCount: count, method: result.method, decision: result.decision, incidentId }),
              now,
            ],
          );
          if (incidentId) {
            await client.query(`UPDATE moderation_incidents SET warning_notification_id = $2 WHERE id = $1`, [incidentId, notificationId]);
          }
        }

        await client.query('COMMIT');
        outcome = { eventId, incidentId, count, flagged, newlyFlagged, severity, notificationId, showWarning: result.decision !== 'ALLOW' };
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

    // Lightweight incident-only insert for Asset Gallery upload-format
    // rejections (wrong file type, too large, failed magic-byte sniff).
    // Deliberately does NOT touch moderation_events or the escalation
    // counter — these are format mistakes, not content-safety violations,
    // and must never count toward FLAG_THRESHOLD. Purely for the Violations
    // dashboard's "Source: Asset Gallery" completeness.
    async recordUploadRejectionIncident({ userId, reason, idempotencyKey, filename }) {
      const id = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO moderation_incidents (
           id, idempotency_key, user_id, source, category, decision, status, method, safe_metadata, created_at
         ) VALUES ($1,$2,$3,'ASSET_GALLERY_UPLOAD','UPLOAD_FORMAT','UPLOAD_REJECTED','RESOLVED','FORMAT_VALIDATION',$4,$5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [id, idempotencyKey, userId, JSON.stringify({ reason, filename }), new Date().toISOString()],
      );
      return { incidentId: rows[0]?.id ?? null };
    },

    // GET /internal/moderation/incidents — Super Admin Violations list.
    // Filters are all optional; deleted (soft-deleted) rows excluded unless
    // includeArchived is explicitly true.
    async listIncidents({ status, category, source, userId, page = 1, pageSize = 25, includeArchived = false } = {}) {
      const where = [];
      const params = [];
      if (!includeArchived) where.push('i.deleted_at IS NULL');
      if (status) { params.push(status); where.push(`i.status = $${params.length}`); }
      if (category) { params.push(category); where.push(`i.category = $${params.length}`); }
      if (source) { params.push(source); where.push(`i.source = $${params.length}`); }
      if (userId) { params.push(userId); where.push(`i.user_id = $${params.length}`); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const { rows } = await pool.query(
        `SELECT i.*, u.name AS user_name, u.email AS user_email
           FROM moderation_incidents i JOIN users u ON u.id = i.user_id
           ${whereSql}
          ORDER BY i.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      const countRes = await pool.query(`SELECT count(*) AS n FROM moderation_incidents i ${whereSql}`, params);
      return { incidents: rows, total: Number(countRes.rows[0]?.n || 0), page: Math.max(Number(page) || 1, 1), pageSize: limit };
    },

    // GET /internal/moderation/incidents/:id — full detail for the Super
    // Admin incident view. mediaViewUrl is NOT resolved here (that's
    // admin-service's job, with its own signing secret) — this just
    // returns whether media exists and whether it's restricted.
    async getIncidentById(id) {
      const { rows } = await pool.query(
        `SELECT i.*, u.name AS user_name, u.email AS user_email
           FROM moderation_incidents i JOIN users u ON u.id = i.user_id
          WHERE i.id = $1`,
        [id],
      );
      return rows[0] || null;
    },

    // Self-scoped: a regular user viewing their OWN warning detail. The
    // userId=$2 clause is the entire access-control boundary — a user can
    // never fetch someone else's incident by id alone.
    async getUserIncidentById(userId, incidentId) {
      const { rows } = await pool.query(
        `SELECT id, source, platform, category, decision, status, confidence, created_at, review_note
           FROM moderation_incidents WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [incidentId, userId],
      );
      return rows[0] || null;
    },

    // GET /internal/moderation/incidents/stats — one-query dashboard
    // aggregate, mirrors /internal/moderation/queue's "one query for the
    // whole page" style.
    async getIncidentStats() {
      const totals = await pool.query(`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE status = 'BLOCKED') AS blocked,
          count(*) FILTER (WHERE status = 'UNCERTAIN') AS uncertain,
          count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS recent
        FROM moderation_incidents WHERE deleted_at IS NULL
      `);
      const byCategory = await pool.query(`
        SELECT category, count(*) AS n FROM moderation_incidents WHERE deleted_at IS NULL GROUP BY category ORDER BY n DESC
      `);
      const byUser = await pool.query(`
        SELECT i.user_id, u.name, u.email, count(*) AS n
          FROM moderation_incidents i JOIN users u ON u.id = i.user_id
         WHERE i.deleted_at IS NULL
         GROUP BY i.user_id, u.name, u.email
         ORDER BY n DESC LIMIT 20
      `);
      const t = totals.rows[0] || {};
      return {
        total: Number(t.total || 0), blocked: Number(t.blocked || 0), uncertain: Number(t.uncertain || 0), recent: Number(t.recent || 0),
        byCategory: byCategory.rows.map((r) => ({ category: r.category, count: Number(r.n) })),
        repeatOffenders: byUser.rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, count: Number(r.n) })),
      };
    },

    // POST /internal/moderation/incidents/:id — Super Admin action:
    // mark-under-review | resolve | dismiss-false-positive | escalate-restricted.
    // dismiss-false-positive is the only action that also unwinds the
    // escalation counter (atomically, same transaction) — a corrected
    // incident must not keep counting toward FLAG_THRESHOLD.
    async applyIncidentAction(incidentId, adminId, action, note) {
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const incRes = await client.query('SELECT * FROM moderation_incidents WHERE id = $1 FOR UPDATE', [incidentId]);
        const incident = incRes.rows[0];
        if (!incident) { await client.query('ROLLBACK'); return { error: 'Incident not found.' }; }

        if (action === 'mark-under-review') {
          await client.query(`UPDATE moderation_incidents SET status = 'UNDER_REVIEW', reviewed_by_admin_id = $2, reviewed_at = $3, review_note = COALESCE($4, review_note) WHERE id = $1`, [incidentId, adminId, now, note ?? null]);
        } else if (action === 'resolve') {
          await client.query(`UPDATE moderation_incidents SET status = 'RESOLVED', reviewed_by_admin_id = $2, reviewed_at = $3, review_note = COALESCE($4, review_note) WHERE id = $1`, [incidentId, adminId, now, note ?? null]);
        } else if (action === 'escalate-restricted') {
          if (incident.status !== 'UNDER_REVIEW') { await client.query('ROLLBACK'); return { error: 'Only incidents already under review can be escalated to restricted.' }; }
          await client.query(`UPDATE moderation_incidents SET category = 'RESTRICTED_CSAM', media_restricted = true, content_preview = NULL, reviewed_by_admin_id = $2, reviewed_at = $3, review_note = COALESCE($4, review_note) WHERE id = $1`, [incidentId, adminId, now, note ?? null]);
        } else if (action === 'dismiss-false-positive') {
          await client.query(`UPDATE moderation_incidents SET status = 'DISMISSED_FALSE_POSITIVE', reviewed_by_admin_id = $2, reviewed_at = $3, review_note = COALESCE($4, review_note) WHERE id = $1`, [incidentId, adminId, now, note ?? null]);
          // Unwind the escalation counter — a dismissed false positive must
          // not keep counting toward FLAG_THRESHOLD/severity.
          const userRes = await client.query('SELECT moderation_violation_count FROM users WHERE id = $1 FOR UPDATE', [incident.user_id]);
          const newCount = Math.max(0, Number(userRes.rows[0]?.moderation_violation_count || 0) - 1);
          await client.query(
            `UPDATE users SET moderation_violation_count = $2::int, moderation_flagged = ($2::int >= $3::int) AND moderation_flagged WHERE id = $1`,
            [incident.user_id, newCount, FLAG_THRESHOLD],
          );
        } else {
          await client.query('ROLLBACK');
          return { error: 'Unknown incident action.' };
        }

        await client.query('COMMIT');
        return { success: true };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    // Soft-delete cleanup: incidents older than INCIDENT_RETENTION_DAYS get
    // deleted_at set (never a hard DELETE — audit trail integrity for
    // repeat-offender tracking must survive). RESTRICTED_CSAM incidents are
    // permanently exempt — manual Super Admin action only.
    async cleanupExpiredIncidents(retentionDays = INCIDENT_RETENTION_DAYS) {
      const { rowCount } = await pool.query(
        `UPDATE moderation_incidents SET deleted_at = now()
          WHERE deleted_at IS NULL AND category <> 'RESTRICTED_CSAM' AND created_at < now() - ($1 || ' days')::interval`,
        [retentionDays],
      );
      return { archived: rowCount };
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
