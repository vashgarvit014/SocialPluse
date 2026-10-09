// Faithful port of src/lib/post-store.ts, PLUS a real atomic claim
// (claimDueJob) replacing the original claimDuePosts()+updatePostById()
// pair, which had a genuine TOCTOU race — see the migration comment in
// src/lib/db.ts for why. scrubUserPostAccounts() lives here too: scheduler
// owns scheduled_posts, so integrations-service disconnect cleanup should
// not call back into the frontend app.

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function hydrate(row) {
  return { ...(row.payload || {}), id: row.id, status: row.status, scheduledAt: row.scheduled_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

const SELECT_COLUMNS = 'id, user_id, status, scheduled_at, created_at, updated_at, payload, retry_count, next_retry_at, locked_at';

export function createPostStore(pool, legacyFilePath) {
  async function importLegacyPosts() {
    const done = await pool.query('SELECT key FROM data_migrations WHERE key = $1', ['legacy_posts_imported']);
    if (done.rows.length > 0) return;
    if (!legacyFilePath || !existsSync(legacyFilePath)) {
      await pool.query('INSERT INTO data_migrations (key, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['legacy_posts_imported', new Date().toISOString()]);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(legacyFilePath, 'utf8'));
    } catch {
      throw new Error('Post storage is invalid. Existing data has not been changed.');
    }
    const legacy = (Array.isArray(parsed) ? parsed : []).filter((p) => p && typeof p.id === 'string' && Array.isArray(p.platforms));
    let imported = 0;
    let skipped = 0;
    for (const post of legacy) {
      try {
        await pool.query(
          `INSERT INTO scheduled_posts (id, status, scheduled_at, created_at, updated_at, payload, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, NULL) ON CONFLICT (id) DO NOTHING`,
          [post.id, typeof post.status === 'string' ? post.status : 'draft', post.scheduledAt ?? null, post.createdAt || new Date().toISOString(), post.updatedAt || post.createdAt || new Date().toISOString(), JSON.stringify(post)],
        );
        imported++;
      } catch (err) {
        skipped++;
        console.error(`[scheduler-service] legacy import skipped post ${String(post.id).slice(0, 40)}:`, err instanceof Error ? err.message : err);
      }
    }
    await pool.query('INSERT INTO data_migrations (key, applied_at, details) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', ['legacy_posts_imported', new Date().toISOString(), JSON.stringify({ imported, skipped, total: legacy.length })]);
  }

  let legacyImport = null;
  function ensureLegacyImported() {
    if (!legacyImport) {
      legacyImport = importLegacyPosts().catch((err) => { legacyImport = null; throw err; });
    }
    return legacyImport;
  }

  return {
    async listUserPosts(userId) {
      await ensureLegacyImported();
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      return rows.map(hydrate);
    },

    async getUserPost(userId, id) {
      await ensureLegacyImported();
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1 AND user_id = $2`, [id, userId]);
      return rows[0] ? hydrate(rows[0]) : null;
    },

    async upsertUserPost(userId, post, db = pool) {
      await ensureLegacyImported();
      const existingRows = post.id ? (await db.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1 AND user_id = $2`, [post.id, userId])).rows : [];
      const existing = existingRows[0] ? hydrate(existingRows[0]) : null;
      const now = new Date().toISOString();
      const record = { ...post, id: existing?.id || post.id || randomUUID() };
      await db.query(
        `INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, scheduled_at = EXCLUDED.scheduled_at, updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
         WHERE scheduled_posts.user_id = EXCLUDED.user_id`,
        [record.id, userId, record.status, record.scheduledAt ?? null, existing?.createdAt || record.createdAt || now, now, JSON.stringify(record)],
      );
      return record;
    },

    async updateUserPost(userId, id, update, db = pool) {
      await ensureLegacyImported();
      const { rows } = await db.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1 AND user_id = $2`, [id, userId]);
      if (!rows[0]) throw new Error('Post not found');
      const current = hydrate(rows[0]);
      const next = update(current);
      const now = new Date().toISOString();
      await db.query(`UPDATE scheduled_posts SET status = $3, scheduled_at = $4, updated_at = $5, payload = $6 WHERE id = $1 AND user_id = $2`, [id, userId, next.status, next.scheduledAt ?? null, now, JSON.stringify({ ...next, updatedAt: now })]);
      return { ...next, updatedAt: now };
    },

    async deleteUserPost(userId, id) {
      await ensureLegacyImported();
      const { rows } = await pool.query('DELETE FROM scheduled_posts WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
      return rows.length > 0;
    },

    async scrubUserPostAccounts(userId, platform, providerUserId) {
      await ensureLegacyImported();
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE user_id = $1`, [userId]);
      let scrubbed = 0;
      for (const row of rows) {
        const accounts = row.payload?.accounts;
        if (!Array.isArray(accounts)) continue;
        let changed = false;
        const nextAccounts = accounts.map((account) => {
          if (account?.platform !== platform) return account;
          if (providerUserId && account.userId && account.userId !== providerUserId) return account;
          if (!('accessToken' in account) && !('userId' in account)) return account;
          const { accessToken: _drop, userId: _dropId, ...rest } = account;
          void _drop; void _dropId;
          changed = true;
          return rest;
        });
        if (!changed) continue;
        scrubbed++;
        await pool.query('UPDATE scheduled_posts SET payload = $2, updated_at = $3 WHERE id = $1 AND user_id = $4', [
          row.id,
          JSON.stringify({ ...row.payload, accounts: nextAccounts }),
          new Date().toISOString(),
          userId,
        ]);
      }
      return scrubbed;
    },

    // --- System reads: Superadmin / worker only, never user-facing ---

    async listAllPosts() {
      await ensureLegacyImported();
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts ORDER BY created_at DESC LIMIT 2000`);
      return rows.map((r) => ({ ...hydrate(r), userId: r.user_id }));
    },

    async getPostById(id) {
      await ensureLegacyImported();
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1`, [id]);
      return rows[0] ? { ...hydrate(rows[0]), userId: rows[0].user_id } : null;
    },

    // Superadmin-only narrow transitions (retry/move-to-draft a FAILED
    // post) — Phase 12, moved out of the monolith's publishing-monitor.ts.
    // Not racing claimDueJob: that only ever claims 'pending' rows, never
    // 'failed' ones, so no concurrent-claim guard is needed here, same as
    // the original monolith functions this replaces.
    async adminUpdatePost(id, update) {
      await ensureLegacyImported();
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1`, [id]);
      if (!rows[0]) throw new Error('Post not found');
      const current = { ...hydrate(rows[0]), userId: rows[0].user_id };
      const next = update(current);
      const now = new Date().toISOString();
      await pool.query(`UPDATE scheduled_posts SET status = $2, scheduled_at = $3, updated_at = $4, payload = $5 WHERE id = $1`, [id, next.status, next.scheduledAt ?? null, now, JSON.stringify({ ...next, updatedAt: now })]);
      return { ...next, userId: current.userId, updatedAt: now };
    },

    // Real atomic claim: a single UPDATE ... WHERE ... RETURNING using
    // Postgres's SELECT FOR UPDATE SKIP LOCKED pattern. Two concurrent
    // workers (or a cron tick racing a manual "run now") can run this at
    // the same instant and will never both claim the same row — the DB
    // itself is the lock, not an in-JS check-then-write. Also reclaims
    // stuck "publishing" rows whose lock has gone stale (worker crashed
    // mid-publish) after `staleLockMs`.
    async claimDueJob(workerId, { now = new Date(), staleLockMs = 5 * 60 * 1000, limit = 1 } = {}) {
      const nowIso = now.toISOString();
      const staleCutoff = new Date(now.getTime() - staleLockMs).toISOString();
      const { rows } = await pool.query(
        `UPDATE scheduled_posts SET status = 'publishing', locked_at = $1, locked_by = $2, updated_at = $1
          WHERE id IN (
            SELECT id FROM scheduled_posts
             WHERE scheduled_at IS NOT NULL AND scheduled_at <= $1
               AND (next_retry_at IS NULL OR next_retry_at <= $1)
               AND (
                 status = 'pending'
                 OR (status = 'publishing' AND locked_at IS NOT NULL AND locked_at < $3)
               )
             ORDER BY scheduled_at ASC
             LIMIT $4
             FOR UPDATE SKIP LOCKED
          )
          RETURNING ${SELECT_COLUMNS}`,
        [nowIso, workerId, staleCutoff, limit],
      );
      return rows.map((r) => ({ ...hydrate(r), userId: r.user_id }));
    },

    // Final state after a claimed job finishes (success, permanent failure,
    // or scheduled for retry). Always clears the lock.
    async finishJob(id, { status, nextRetryAt, retryCount, failedPlatforms }) {
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1`, [id]);
      if (!rows[0]) return null;
      const current = hydrate(rows[0]);
      const now = new Date().toISOString();
      const next = { ...current, status, updatedAt: now, ...(failedPlatforms ? { failedPlatforms } : {}) };
      await pool.query(
        `UPDATE scheduled_posts SET status = $2, scheduled_at = $3, updated_at = $4, payload = $5,
            locked_at = NULL, locked_by = NULL, retry_count = $6, next_retry_at = $7
          WHERE id = $1`,
        [id, status, current.scheduledAt ?? null, now, JSON.stringify(next), retryCount ?? 0, nextRetryAt || null],
      );
      return next;
    },

    // Resolves what a prior attempt at (platform, attemptId) ACTUALLY
    // recorded — used when publishing-service reports a duplicate-claim
    // response, so the worker reflects the real historical outcome instead
    // of guessing. Reading publish_attempts directly: both services share
    // this Postgres instance, and this is a read of publishing-service's
    // own durable idempotency record, not a reimplementation of it.
    async getAttemptOutcome(platform, attemptId) {
      const { rows } = await pool.query('SELECT status, provider_post_id FROM publish_attempts WHERE platform = $1 AND attempt_id = $2', [platform, attemptId]);
      if (!rows[0]) return null;
      return { status: rows[0].status, providerPostId: rows[0].provider_post_id };
    },

    // Re-arm a post the USER asked to retry. Strictly user-scoped: you can
    // only retry your own post, and only from a terminal state. Keeps the
    // original scheduled_at (already in the past, so the worker claims it on
    // the next tick) and clears next_retry_at so bounded backoff doesn't
    // push a user-initiated retry into the future.
    async armForRetry(userId, id) {
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1 AND user_id = $2`, [id, userId]);
      if (!rows[0]) throw new Error('Post not found');
      const current = hydrate(rows[0]);
      if (!['failed', 'connection_required', 'partially_published', 'published'].includes(current.status)) {
        throw new Error('Only a failed or partially published post can be retried.');
      }
      const now = new Date().toISOString();
      const next = { ...current, status: 'pending', updatedAt: now };
      await pool.query(
        `UPDATE scheduled_posts SET status = 'pending', updated_at = $3, payload = $4, locked_at = NULL, locked_by = NULL, retry_count = 0, next_retry_at = NULL
          WHERE id = $1 AND user_id = $2`,
        [id, userId, now, JSON.stringify(next)],
      );
      return next;
    },

    // Claim ONE specific post, for the user-triggered "Retry failed" path.
    //
    // The background worker must NOT be used for this: runOnce() claims every
    // due post, so a user clicking "Retry failed" on one post would silently
    // publish unrelated posts too. Same FOR UPDATE SKIP LOCKED guard as
    // claimDueJob, but narrowed to one id and one owner.
    async claimPostById(userId, id, workerId, { now = new Date(), staleLockMs = 5 * 60 * 1000 } = {}) {
      const nowIso = now.toISOString();
      const staleCutoff = new Date(now.getTime() - staleLockMs).toISOString();
      const { rows } = await pool.query(
        `UPDATE scheduled_posts SET status = 'publishing', locked_at = $3, locked_by = $4, updated_at = $3
          WHERE id = $1 AND user_id = $2
            AND scheduled_at IS NOT NULL AND scheduled_at <= $3
            AND (next_retry_at IS NULL OR next_retry_at <= $3)
            AND (
              status = 'pending'
              OR (status = 'publishing' AND locked_at IS NOT NULL AND locked_at < $5)
            )
        RETURNING ${SELECT_COLUMNS}`,
        [id, userId, nowIso, workerId, staleCutoff],
      );
      return rows[0] ? { ...hydrate(rows[0]), userId: rows[0].user_id } : null;
    },

    // Real scheduler health for the Superadmin System Health page. Every
    // number is read from the database — nothing here is a canned status.
    async getSchedulerHealth() {
      const nowIso = new Date().toISOString();
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [due, processing, failed] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS n FROM scheduled_posts WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= $1`, [nowIso]),
        pool.query(`SELECT COUNT(*)::int AS n FROM scheduled_posts WHERE status = 'publishing'`),
        pool.query(`SELECT COUNT(*)::int AS n FROM scheduled_posts WHERE status IN ('failed', 'connection_required', 'partially_published') AND updated_at >= $1`, [since]),
      ]);
      return {
        dueJobs: due.rows[0]?.n || 0,
        processingJobs: processing.rows[0]?.n || 0,
        failedLast24h: failed.rows[0]?.n || 0,
      };
    },
  };
}
