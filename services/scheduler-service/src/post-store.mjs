// Faithful port of src/lib/post-store.ts, PLUS a real atomic claim
// (claimDueJob) replacing the original claimDuePosts()+updatePostById()
// pair, which had a genuine TOCTOU race — see the migration comment in
// src/lib/db.ts for why. scrubUserPostAccounts() is NOT ported here: it's
// already served by the monolith's own /api/internal/scrub-post-accounts
// (built for integrations-service's disconnect routes last round) — no
// reason to duplicate it a second time for this round.

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

    async upsertUserPost(userId, post) {
      await ensureLegacyImported();
      const existingRows = post.id ? (await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1 AND user_id = $2`, [post.id, userId])).rows : [];
      const existing = existingRows[0] ? hydrate(existingRows[0]) : null;
      const now = new Date().toISOString();
      const record = { ...post, id: existing?.id || post.id || randomUUID() };
      await pool.query(
        `INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, scheduled_at = EXCLUDED.scheduled_at, updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
         WHERE scheduled_posts.user_id = EXCLUDED.user_id`,
        [record.id, userId, record.status, record.scheduledAt ?? null, existing?.createdAt || record.createdAt || now, now, JSON.stringify(record)],
      );
      return record;
    },

    async updateUserPost(userId, id, update) {
      await ensureLegacyImported();
      const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1 AND user_id = $2`, [id, userId]);
      if (!rows[0]) throw new Error('Post not found');
      const current = hydrate(rows[0]);
      const next = update(current);
      const now = new Date().toISOString();
      await pool.query(`UPDATE scheduled_posts SET status = $3, scheduled_at = $4, updated_at = $5, payload = $6 WHERE id = $1 AND user_id = $2`, [id, userId, next.status, next.scheduledAt ?? null, now, JSON.stringify({ ...next, updatedAt: now })]);
      return { ...next, updatedAt: now };
    },

    async deleteUserPost(userId, id) {
      await ensureLegacyImported();
      const { rows } = await pool.query('DELETE FROM scheduled_posts WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
      return rows.length > 0;
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
  };
}
