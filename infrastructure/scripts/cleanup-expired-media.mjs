#!/usr/bin/env node
/**
 * Expired-media cleanup.
 *
 *   npm run cleanup:expired-media
 *
 * Retention policy: every persisted user asset carries expires_at =
 * created_at + 30 days. When that moment passes the asset is hidden from the
 * Asset Gallery (the gallery filters `expires_at > now()`), and THIS job
 * reclaims the bytes.
 *
 * Why a job rather than deleting inline at expiry:
 *   - A user's request never blocks on a disk unlink, and a slow or failing
 *     filesystem cannot make the gallery hang.
 *   - Retrying is free. The job only touches rows where deleted_at IS NULL,
 *     so running it twice is a no-op the second time.
 *   - The DB row is kept and marked, so "expired" stays distinguishable from
 *     "user deleted it" in the audit log.
 *
 * Safety: every file path goes through resolveWithinRoot(), which refuses
 * anything that does not resolve inside .media-assets/. A corrupted key can
 * therefore never turn this job into an arbitrary-file-delete primitive.
 *
 * Flags:
 *   --dry-run    report what would be reclaimed, change nothing
 *   --json       machine-readable summary
 *   --days=N     override the window (testing aid; does NOT change the
 *                retention policy baked into saveMediaAsset)
 */

import { Pool, types } from 'pg';
import { randomUUID } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const asJson = args.includes('--json');
const daysArg = args.find(a => a.startsWith('--days='));
const overrideDays = daysArg ? Number(daysArg.split('=')[1]) : null;

// Keep the timestamp parsing behaviour identical to src/lib/db.ts so row
// values here are ISO strings, not Date objects.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

// Resolved relative to this file, not process.cwd() — this script can now
// be invoked either directly (cwd = repo root) or via `npm run` from
// apps/web (cwd = apps/web), and .media-assets lives at the repo root
// either way (infrastructure/scripts/../.. = repo root).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA_ROOT = join(REPO_ROOT, '.media-assets');

/**
 * Mirrors resolveWithinRoot() in src/lib/media-assets.ts. Duplicated rather
 * than imported because this script runs outside the Next.js/TS build (plain
 * node, no bundler) — keep the two in sync.
 */
const NAMESPACE_KEY = /^[a-f0-9-]{36}\/[a-z][a-z0-9_-]{0,31}\/[a-f0-9-]{36}\.[a-z0-9]{1,8}$/i;
// Flat legacy key: pre-namespacing rows stored a bare filename.
const LEGACY_KEY = /^[A-Za-z0-9._-]{1,120}$/;

function resolveWithinRoot(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 300) return null;
  if (key.includes('\0') || key.startsWith('/') || /^[A-Za-z]:[\\/]/.test(key)) return null;
  // Must be EITHER a namespaced key or a flat legacy filename. Anything in
  // between — including a nested "legacy/uploads/x.png", which the app's
  // storagePathFor() rejects — is refused by BOTH implementations. Keeping
  // these in lockstep matters: a key this job accepts but the app rejects
  // would mean bytes being deleted for a file the app can no longer serve.
  const isNamespaced = NAMESPACE_KEY.test(key);
  const isLegacy = LEGACY_KEY.test(key);
  if (!isNamespaced && !isLegacy) return null;
  const absolute = join(MEDIA_ROOT, key);
  // Belt and braces: confirm the joined path is still under the root.
  if (absolute !== MEDIA_ROOT && !absolute.startsWith(MEDIA_ROOT + '/')) return null;
  return absolute;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const now = new Date();
  const cutoff = overrideDays == null ? now : new Date(now.getTime() - overrideDays * 86400000);

  const columns = 'id, user_id, filename, storage_path, thumbnail_path, size, source, expires_at';

  let rows;
  try {
    // The core predicate: past its window AND not already reclaimed.
    // Rows with a NULL user_id are included on purpose - legacy media imported
    // before ownership existed still has to be reclaimed once it expires.
    rows = (
      await pool.query(
        `SELECT ${columns} FROM media_assets
          WHERE deleted_at IS NULL AND expires_at <= $1
          ORDER BY expires_at ASC
          LIMIT 5000`,
        [cutoff.toISOString()],
      )
    ).rows;
  } catch (err) {
    // A missing table means the app has never migrated (no DATABASE yet), not
    // a hard failure worth a stack trace.
    console.error(`[cleanup] could not read expired assets: ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  const summary = {
    scannedAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    dryRun,
    expired: rows.length,
    filesRemoved: 0,
    bytesReclaimed: 0,
    marked: 0,
    skippedUnsafeKey: 0,
    failures: 0,
    events: [],
  };

  for (const row of rows) {
    const paths = [row.storage_path, row.thumbnail_path].filter(Boolean);
    const resolved = [];
    for (const key of paths) {
      const abs = resolveWithinRoot(key);
      if (!abs) {
        summary.skippedUnsafeKey++;
        console.warn(`[cleanup] refusing to touch key outside media root: ${String(key).slice(0, 120)}`);
        continue;
      }
      resolved.push(abs);
    }

    if (!dryRun) {
      for (const abs of resolved) {
        try {
          const st = await stat(abs);
          if (st.isFile()) {
            await unlink(abs);
            summary.filesRemoved++;
            summary.bytesReclaimed += st.size;
          }
        } catch {
          // Already gone. Nothing to reclaim; not an error.
        }
      }

      try {
        // Soft delete: keep the row so MEDIA_EXPIRED stays auditable and
        // distinguishable from a user-initiated delete.
        const updated = await pool.query(
          `UPDATE media_assets SET deleted_at = $2, deleted_reason = 'EXPIRED', updated_at = $2
            WHERE id = $1 AND deleted_at IS NULL`,
          [row.id, now.toISOString()],
        );
        summary.marked += updated.rowCount || 0;
      } catch (err) {
        summary.failures++;
        console.error(`[cleanup] failed to mark ${row.id}: ${err.message}`);
        continue;
      }

      // Structured operational event, written through the same system_logs
      // table the Superadmin timeline reads. Metadata only - never paths that
      // could leak a layout, and never content.
      try {
        await pool.query(
          `INSERT INTO system_logs
             (id, created_at, level, category, event, user_id, message, metadata)
           VALUES ($1, $2, 'INFO', 'MEDIA', 'MEDIA_EXPIRED', $3, $4, $5)`,
          [
            randomUUID(),
            now.toISOString(),
            row.user_id,
            `Media asset expired after its ${overrideDays ?? 30}-day retention window and was reclaimed`,
            JSON.stringify({
              assetId: row.id,
              filename: row.filename,
              source: row.source,
              size: Number(row.size),
              expiresAt: row.expires_at,
            }),
          ],
        );
        summary.events.push('MEDIA_EXPIRED');
      } catch (err) {
        // Logging must never block reclamation.
        console.error(`[cleanup] MEDIA_EXPIRED log failed for ${row.id}: ${err.message}`);
      }
    }
  }

  await pool.end();

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const mb = (summary.bytesReclaimed / 1024 / 1024).toFixed(1);
    console.log(
      `[cleanup] ${dryRun ? 'dry run: ' : ''}${summary.expired} expired asset(s); ` +
        `${summary.filesRemoved} file(s) removed, ${mb} MB reclaimed, ${summary.marked} row(s) marked, ` +
        `${summary.events.length} MEDIA_EXPIRED event(s), ${summary.skippedUnsafeKey} unsafe key(s) skipped, ${summary.failures} failure(s).`,
    );
  }
}

main().catch(err => {
  console.error('[cleanup] unexpected failure:', err);
  process.exit(1);
});