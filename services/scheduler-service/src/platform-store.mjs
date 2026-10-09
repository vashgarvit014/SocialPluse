// Per-platform rows for a scheduled post — scheduled_post_platforms.
//
// Owned by scheduler-service (same owner as scheduled_posts). One row per
// (post, target platform), because a multi-platform post must never be
// reduced to a single overall status: LinkedIn publishing successfully while
// Instagram is disconnected is a PARTIAL result, and "Retry failed" has to be
// able to re-run exactly one platform without republishing the others.
//
// DDL is idempotent and mirrors apps/web/src/lib/db.ts (canonical). It runs
// here too because this service may boot before the web app does, and the
// worker cannot wait on another process to create its own table.

// Each value is individually quoted: interpolating a bare
// "PENDING, PROCESSING, ..." into a CHECK constraint's IN list would make
// Postgres read them as column names, not string literals.
const UPPERCASE = "'PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CONNECTION_REQUIRED', 'CANCELLED'";

export function createPlatformStore(pool) {
  async function ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_post_platforms (
        id UUID PRIMARY KEY,
        scheduled_post_id TEXT NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        platform_connection_id UUID,
        destination TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (${UPPERCASE})),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        external_post_id TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (scheduled_post_id, platform)
      )
    `);
    // The worker scans "every platform row still pending whose post is due"
    // and the disconnect flow scans "every future pending row for this user
    // and platform". Both need this; without it both table-scan.
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_spp_user_platform_status ON scheduled_post_platforms(user_id, platform, status)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_spp_post ON scheduled_post_platforms(scheduled_post_id)`,
    );
  }

  /**
   * (Re)build the platform rows for a post at schedule time.
   *
   * Always resets: rescheduling or editing a scheduled post re-derives the
   * target set from scratch, so a platform the user removed stops being a
   * target and one they added starts as PENDING. Existing PUBLISHED rows are
   * deliberately NOT resurrected — see the guard, which keeps rows that are
   * already published so a partial post can be edited without un-publishing
   * what already went out.
   */
  async function syncForPost(postId, userId, targets, db = pool) {
    const now = new Date().toISOString();
    const wanted = new Map();
    for (const t of targets) {
      if (!t?.platform) continue;
      if (wanted.has(t.platform)) continue; // one row per platform
      wanted.set(t.platform, t);
    }

    const existing = await db.query(
      `SELECT id, platform, status FROM scheduled_post_platforms WHERE scheduled_post_id = $1 AND user_id = $2`,
      [postId, userId],
    );
    const existingByPlatform = new Map(existing.rows.map((r) => [r.platform, r]));

    // Drop rows for platforms no longer targeted (unless already published).
    for (const row of existing.rows) {
      if (wanted.has(row.platform)) continue;
      if (row.status === 'PUBLISHED' || row.status === 'PROCESSING') continue;
      await db.query(
        `DELETE FROM scheduled_post_platforms WHERE id = $1 AND user_id = $2`,
        [row.id, userId],
      );
    }

    for (const [platform, target] of wanted) {
      const prior = existingByPlatform.get(platform);
      if (prior && (prior.status === 'PUBLISHED' || prior.status === 'PROCESSING')) continue;
      if (prior) {
        // Re-arming an edited schedule returns it to PENDING and clears the
        // previous outcome; the connection is re-checked at publish time.
        await db.query(
          `UPDATE scheduled_post_platforms
              SET status = 'PENDING', attempt_count = 0, last_attempt_at = NULL,
                  published_at = NULL, external_post_id = NULL,
                  error_code = NULL, error_message = NULL,
                  platform_connection_id = NULL, destination = $3, updated_at = $4
            WHERE id = $1 AND user_id = $2`,
          [prior.id, userId, target.destination || null, now],
        );
      } else {
        await db.query(
          `INSERT INTO scheduled_post_platforms
             (id, scheduled_post_id, user_id, platform, platform_connection_id, destination,
              status, attempt_count, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NULL, $5, 'PENDING', 0, $6, $6)
           ON CONFLICT (scheduled_post_id, platform) DO NOTHING`,
          [crypto.randomUUID(), postId, userId, platform, target.destination || null, now],
        );
      }
    }
  }

  /**
   * Cancel every still-unpublished platform row for a post.
   *
   * Used when a post is saved as a draft or cancelled: the parent status
   * ('draft') already stops the worker claiming it, but the rows must not be
   * left claiming to be pending — a later re-schedule is the only thing that
   * should put them back in the queue, and PUBLISHED rows are preserved so
   * editing a partially published post never un-publishes it.
   */
  async function cancelAllForPost(userId, postId, db = pool) {
    const now = new Date().toISOString();
    const { rows } = await db.query(
      `UPDATE scheduled_post_platforms
          SET status = 'CANCELLED', updated_at = $3
        WHERE user_id = $1 AND scheduled_post_id = $2
          AND status IN ('PENDING', 'FAILED', 'CONNECTION_REQUIRED')
        RETURNING id`,
      [userId, postId, now],
    );
    return rows.length;
  }

  /** User-scoped read — never returns another user's rows. */
  async function listForPost(postId, userId) {
    const { rows } = await pool.query(
      `SELECT * FROM scheduled_post_platforms
        WHERE scheduled_post_id = $1 AND user_id = $2
        ORDER BY created_at ASC`,
      [postId, userId],
    );
    return rows.map(hydrate);
  }

  /** Unscoped read for the worker/superadmin (post ownership already checked). */
  async function listForPostUnscoped(postId) {
    const { rows } = await pool.query(
      `SELECT * FROM scheduled_post_platforms WHERE scheduled_post_id = $1 ORDER BY created_at ASC`,
      [postId],
    );
    return rows.map(hydrate);
  }

  /** Batch read for the scheduler list view. */
  async function listForPosts(postIds) {
    if (!postIds.length) return [];
    const { rows } = await pool.query(
      `SELECT * FROM scheduled_post_platforms WHERE scheduled_post_id = ANY($1) ORDER BY created_at ASC`,
      [postIds],
    );
    return rows.map(hydrate);
  }

  /**
   * Atomic claim of ONE platform row -> PROCESSING. Returns null if another
   * worker already holds a FRESH claim or the row is already PUBLISHED — the
   * UPDATE ... WHERE ... is the lock, so two workers racing the same row can
   * never both win.
   *
   * This is what makes "retry only the failed platform" safe: PUBLISHED rows
   * are not in the claimable set, so they can never be republished by a retry.
   *
   * A PROCESSING row whose last_attempt_at is older than staleMs IS
   * re-claimable: that is crash recovery for a worker that died mid-publish.
   * Re-publishing after such a crash is still safe because publishing-service
   * rejects a second publish of the same attemptId (and reports the real
   * prior outcome, which the worker reads before trusting it).
   */
  async function claimPlatform(postId, platform, userId, { connectionId = null, destination = null, staleMs = 5 * 60 * 1000 } = {}) {
    const now = new Date().toISOString();
    const staleCutoff = new Date(Date.now() - staleMs).toISOString();
    const { rows } = await pool.query(
      `UPDATE scheduled_post_platforms
          SET status = 'PROCESSING',
              attempt_count = attempt_count + 1,
              last_attempt_at = $3,
              platform_connection_id = COALESCE($4, platform_connection_id),
              destination = COALESCE($5, destination),
              error_code = NULL, error_message = NULL,
              updated_at = $3
        WHERE scheduled_post_id = $1 AND user_id = $2 AND platform = $6
          AND (
            status IN ('PENDING', 'FAILED', 'CONNECTION_REQUIRED')
            OR (status = 'PROCESSING' AND (last_attempt_at IS NULL OR last_attempt_at < $7))
          )
        RETURNING *`,
      [postId, userId, now, connectionId, destination, platform, staleCutoff],
    );
    return rows[0] ? hydrate(rows[0]) : null;
  }

  async function finishPlatform(postId, userId, platform, outcome) {
    const now = new Date().toISOString();
    const status = outcome.status;
    if (status === 'PUBLISHED') {
      const { rows } = await pool.query(
        `UPDATE scheduled_post_platforms
            SET status = 'PUBLISHED', published_at = $3, external_post_id = $4,
                error_code = NULL, error_message = NULL, updated_at = $3
          WHERE scheduled_post_id = $1 AND user_id = $2 AND platform = $5
          RETURNING *`,
        [postId, userId, now, outcome.externalPostId || null, platform],
      );
      return rows[0] ? hydrate(rows[0]) : null;
    }
    const { rows } = await pool.query(
      `UPDATE scheduled_post_platforms
          SET status = $3, error_code = $4, error_message = $5, updated_at = $6
        WHERE scheduled_post_id = $1 AND user_id = $2 AND platform = $7
        RETURNING *`,
      [postId, userId, status, outcome.errorCode || null, outcome.errorMessage || null, now, platform],
    );
    return rows[0] ? hydrate(rows[0]) : null;
  }

  /**
   * Mark every FUTURE scheduled row for this user+platform CONNECTION_REQUIRED.
   * Called by the disconnect flow so the warning is visible before the due
   * time rather than only after the worker discovers it.
   *
   * Scoped by user_id AND platform — cannot touch another user's rows.
   */
  async function markFutureConnectionRequired(userId, platform, message) {
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `UPDATE scheduled_post_platforms spp
          SET status = 'CONNECTION_REQUIRED', error_code = $3, error_message = $4, updated_at = $5
        FROM scheduled_posts sp
       WHERE spp.scheduled_post_id = sp.id
         AND spp.user_id = $1
         AND spp.platform = $2
         AND sp.status IN ('pending', 'scheduled')
         AND (sp.scheduled_at IS NULL OR sp.scheduled_at > $5)
         AND spp.status IN ('PENDING', 'FAILED', 'CONNECTION_REQUIRED')
       RETURNING spp.scheduled_post_id`,
      [userId, platform, `${platform.toUpperCase()}_NOT_CONNECTED`, message, now],
    );
    return rows.length;
  }

  /** Post-disconnect: put the platform rows back in the queue once reconnected. */
  async function releaseConnectionRequired(userId, platform) {
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `UPDATE scheduled_post_platforms
          SET status = 'PENDING', error_code = NULL, error_message = NULL, updated_at = $3
        WHERE user_id = $1 AND platform = $2 AND status = 'CONNECTION_REQUIRED'
        RETURNING scheduled_post_id`,
      [userId, platform, now],
    );
    return rows.length;
  }

  /**
   * Select the rows a user-triggered "Retry failed" may re-run: only FAILED
   * and CONNECTION_REQUIRED. PUBLISHED is excluded by construction, which is
   * the guarantee that retrying never republishes a platform that succeeded.
   * Returns them still in their current state; the caller claims each one
   * individually through claimPlatform().
   */
  async function listRetryable(postId, userId, platforms) {
    const { rows } = await pool.query(
      `SELECT * FROM scheduled_post_platforms
        WHERE scheduled_post_id = $1 AND user_id = $2
          AND status IN ('FAILED', 'CONNECTION_REQUIRED')
        ORDER BY created_at ASC`,
      [postId, userId],
    );
    const wanted = Array.isArray(platforms) && platforms.length ? new Set(platforms) : null;
    return rows.map(hydrate).filter((r) => !wanted || wanted.has(r.platform));
  }

  /**
   * Put ONE platform row of ONE post back into the queue for a user retry.
   * Guarded to FAILED/CONNECTION_REQUIRED and to this user's own row, so a
   * retry can never re-arm a platform that already published.
   */
  async function armRowForRetry(userId, postId, platform, db = pool) {
    const now = new Date().toISOString();
    const { rows } = await db.query(
      `UPDATE scheduled_post_platforms
          SET status = 'PENDING', error_code = NULL, error_message = NULL,
              attempt_count = 0, updated_at = $4
        WHERE user_id = $1 AND scheduled_post_id = $2 AND platform = $3
          AND status IN ('FAILED', 'CONNECTION_REQUIRED')
        RETURNING *`,
      [userId, postId, platform, now],
    );
    return rows[0] ? hydrate(rows[0]) : null;
  }

  return {
    ensureSchema,
    syncForPost,
    cancelAllForPost,
    listForPost,
    listForPostUnscoped,
    listForPosts,
    claimPlatform,
    finishPlatform,
    markFutureConnectionRequired,
    releaseConnectionRequired,
    listRetryable,
    armRowForRetry,
  };
}

function hydrate(row) {
  return {
    id: row.id,
    scheduledPostId: row.scheduled_post_id,
    userId: row.user_id,
    platform: row.platform,
    platformConnectionId: row.platform_connection_id,
    destination: row.destination,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    lastAttemptAt: iso(row.last_attempt_at),
    publishedAt: iso(row.published_at),
    externalPostId: row.external_post_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}
