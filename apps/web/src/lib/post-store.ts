import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import type { PostRecord } from './posts';

// Scheduled posts, drafts and published history. Previously a single global
// scheduled-posts.json (48MB by now) with no owner field at all: every
// authenticated user could read, edit, reschedule and cancel every other
// user's posts through GET/POST/PATCH/DELETE /api/scheduler. It now lives in
// Postgres with a real owner column.
//
// Two rules govern every function here:
//   1. A caller that acts on behalf of a user passes that user's id and the
//      query is filtered on it. There is no by-id-only variant for user-facing
//      routes — that shape is the IDOR this module exists to prevent.
//   2. Cross-user reads (listAllPosts) are for the Superadmin surfaces only.
//      Callers must already be behind requireApiSuperadmin().

const LEGACY_FILE = () => join(process.cwd(), 'scheduled-posts.json');

interface PostRow {
  id: string;
  user_id: string | null;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  payload: PostRecord;
}

function hydrate(row: PostRow): PostRecord {
  // payload is the source of truth for the record body; the promoted columns
  // are re-applied on top so the two can never disagree (a partial UPDATE that
  // touched only `status` would otherwise leave payload.status stale).
  return {
    ...(row.payload || {}),
    id: row.id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// One-shot import of the pre-ownership JSON file. Rows land with
// user_id = NULL: they have no provable owner and guessing one would hand a
// stranger someone else's content. NULL-owner rows are invisible to every
// user-facing query (which always filters `user_id = $1`) and remain visible
// only to Superadmin. The file is left on disk untouched — never deleted, so
// a bad import can always be re-derived.
async function importLegacyPosts(): Promise<void> {
  const done = await query<{ key: string }>('SELECT key FROM data_migrations WHERE key = $1', ['legacy_posts_imported']);
  if (done.length > 0) return;
  if (!existsSync(LEGACY_FILE())) {
    await query('INSERT INTO data_migrations (key, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['legacy_posts_imported', new Date().toISOString()]);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(LEGACY_FILE(), 'utf8'));
  } catch {
    // Corrupt file: do NOT mark as done, and do NOT touch the DB. Same policy
    // the old loader had ("Existing data has not been changed").
    throw new Error('Post storage is invalid. Existing data has not been changed.');
  }
  const legacy = (Array.isArray(parsed) ? parsed : []).filter(
    (p): p is PostRecord => !!p && typeof p.id === 'string' && Array.isArray(p.platforms),
  );
  // Per-row resilience: one malformed record must not abort the migration and
  // take every user's draft creation down with it. Failures are counted and
  // reported, never silently dropped.
  let imported = 0;
  let skipped = 0;
  for (const post of legacy) {
    try {
      await query(
        `INSERT INTO scheduled_posts (id, status, scheduled_at, created_at, updated_at, payload, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [
          post.id,
          typeof post.status === 'string' ? post.status : 'draft',
          post.scheduledAt ?? null,
          post.createdAt || new Date().toISOString(),
          post.updatedAt || post.createdAt || new Date().toISOString(),
          JSON.stringify(post),
        ],
      );
      imported++;
    } catch (err) {
      skipped++;
      console.error(
        `[post-store] legacy import skipped post ${String(post.id).slice(0, 40)}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  await query(
    'INSERT INTO data_migrations (key, applied_at, details) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    ['legacy_posts_imported', new Date().toISOString(), JSON.stringify({ imported, skipped, total: legacy.length })],
  );
  if (skipped > 0) {
    console.warn(`[post-store] legacy import finished with ${skipped}/${legacy.length} record(s) skipped.`);
  }
}

let legacyImport: Promise<void> | null = null;
function ensureLegacyImported(): Promise<void> {
  if (!legacyImport) {
    legacyImport = importLegacyPosts().catch((err) => {
      legacyImport = null; // let a later request retry rather than cache the failure forever
      throw err;
    });
  }
  return legacyImport;
}

const SELECT_COLUMNS = 'id, user_id, status, scheduled_at, created_at, updated_at, payload';

// ---------------------------------------------------------------------
// User-scoped reads. Every one of these requires an explicit userId and
// filters on it in SQL — there is deliberately no `listPosts()` with no arg.
// ---------------------------------------------------------------------

export async function listUserPosts(userId: string): Promise<PostRecord[]> {
  await ensureLegacyImported();
  const rows = await query<PostRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(hydrate);
}

export async function getUserPost(userId: string, id: string): Promise<PostRecord | null> {
  await ensureLegacyImported();
  const rows = await query<PostRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0] ? hydrate(rows[0]) : null;
}

// Insert-or-update, always stamped with the owning user. The ON CONFLICT is
// qualified with `WHERE user_id = $n` so a user cannot steal an existing row
// by sending someone else's post id — the write becomes a no-op instead of an
// ownership transfer.
export async function upsertUserPost(userId: string, post: PostRecord): Promise<PostRecord> {
  await ensureLegacyImported();
  const existing = post.id ? await getUserPost(userId, post.id) : null;
  const now = new Date().toISOString();
  const record: PostRecord = { ...post, id: existing?.id || post.id || randomUUID() };
  await query(
    `INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           scheduled_at = EXCLUDED.scheduled_at,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload
     WHERE scheduled_posts.user_id = EXCLUDED.user_id`,
    [
      record.id,
      userId,
      record.status,
      record.scheduledAt ?? null,
      existing?.createdAt || record.createdAt || now,
      now,
      JSON.stringify(record),
    ],
  );
  return record;
}

// Read-modify-write for one user's post. Throws when the post does not exist
// OR belongs to someone else — callers map that to 404, not 403, so the
// response does not reveal that the other user's id is real.
export async function updateUserPost(
  userId: string,
  id: string,
  update: (post: PostRecord) => PostRecord,
): Promise<PostRecord> {
  await ensureLegacyImported();
  const current = await getUserPost(userId, id);
  if (!current) throw new Error('Post not found');
  const next = update(current);
  const now = new Date().toISOString();
  await query(
    `UPDATE scheduled_posts
        SET status = $3, scheduled_at = $4, updated_at = $5, payload = $6
      WHERE id = $1 AND user_id = $2`,
    [id, userId, next.status, next.scheduledAt ?? null, now, JSON.stringify({ ...next, updatedAt: now })],
  );
  return { ...next, updatedAt: now };
}

export async function deleteUserPost(userId: string, id: string): Promise<boolean> {
  await ensureLegacyImported();
  const rows = await query<{ id: string }>(
    'DELETE FROM scheduled_posts WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------
// System / cross-user reads. Callers MUST be Superadmin-gated or the publish
// worker. Never reachable from a user-facing route with a user-supplied id.
// ---------------------------------------------------------------------

export async function listAllPosts(): Promise<(PostRecord & { userId: string | null })[]> {
  await ensureLegacyImported();
  const rows = await query<PostRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_posts ORDER BY created_at DESC LIMIT 2000`,
  );
  return rows.map(r => ({ ...hydrate(r), userId: r.user_id }));
}

export async function getPostById(id: string): Promise<(PostRecord & { userId: string | null }) | null> {
  await ensureLegacyImported();
  const rows = await query<PostRow>(`SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? { ...hydrate(row), userId: row.user_id } : null;
}

export async function updatePostById(
  id: string,
  update: (post: PostRecord) => PostRecord,
): Promise<PostRecord & { userId: string | null }> {
  await ensureLegacyImported();
  const current = await getPostById(id);
  if (!current) throw new Error('Post not found');
  const next = update(current);
  const now = new Date().toISOString();
  await query(
    `UPDATE scheduled_posts SET status = $2, scheduled_at = $3, updated_at = $4, payload = $5 WHERE id = $1`,
    [id, next.status, next.scheduledAt ?? null, now, JSON.stringify({ ...next, updatedAt: now })],
  );
  return { ...next, userId: current.userId, updatedAt: now };
}

// Due work for the publish worker: every user's pending posts whose time has
// come. This crosses users BY DESIGN — one shared worker drains one queue.
// Ownership still rides along on the returned records so each publish
// resolves tokens for the post's own owner, not for whoever triggered the tick.
export async function claimDuePosts(now: Date): Promise<(PostRecord & { userId: string | null })[]> {
  await ensureLegacyImported();
  const rows = await query<PostRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_posts
      WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= $1
      ORDER BY scheduled_at ASC
      LIMIT 200`,
    [now.toISOString()],
  );
  return rows.map(r => ({ ...hydrate(r), userId: r.user_id }));
}

// Strips a platform account's credential references out of a user's stored
// posts so a disconnect can never be undone by a leftover copy in a post body.
export async function scrubUserPostAccounts(
  userId: string,
  platform: string,
  providerUserId: string | null,
): Promise<number> {
  await ensureLegacyImported();
  const rows = await query<PostRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_posts WHERE user_id = $1`,
    [userId],
  );
  let scrubbed = 0;
  for (const row of rows) {
    const accounts = row.payload?.accounts;
    if (!Array.isArray(accounts)) continue;
    let changed = false;
    const nextAccounts = accounts.map((a) => {
      if (a?.platform !== platform) return a;
      if (providerUserId && a.userId && a.userId !== providerUserId) return a;
      if (!('accessToken' in a) && !('userId' in a)) return a;
      const { accessToken: _drop, userId: _dropId, ...rest } = a as PostRecord['accounts'][number] & { accessToken?: string };
      void _drop; void _dropId;
      changed = true;
      return rest as PostRecord['accounts'][number];
    });
    if (!changed) continue;
    scrubbed++;
    await query('UPDATE scheduled_posts SET payload = $2, updated_at = $3 WHERE id = $1 AND user_id = $4', [
      row.id,
      JSON.stringify({ ...row.payload, accounts: nextAccounts }),
      new Date().toISOString(),
      userId,
    ]);
  }
  return scrubbed;
}