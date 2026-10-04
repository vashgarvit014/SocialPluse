// Faithful port of src/lib/media-assets.ts — same table (media_assets, same
// shared Postgres), same path-traversal/symlink guards, same 30-day
// retention math, same user-namespaced storage-key layout. Root is
// configurable (see server.mjs) rather than hardcoded to `.media-assets` —
// see MIGRATION-NOTES.md for why this service bind-mounts the SAME host
// directory the monolith already uses, rather than forking the data.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXTS = ['mp4', 'mov'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const BUCKETS = {
  UPLOAD: 'uploads', AI_GENERATED: 'generated', AI: 'generated',
  CANVA_IMPORT: 'canva', CANVA: 'canva', BRANDED: 'branded',
  CAROUSEL: 'carousels', OTHER: 'other', SESSION: 'other',
};

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BUCKET_FRAGMENT = '[a-z][a-z0-9_-]{0,31}';
const VALID_KEY = new RegExp(`^[a-f0-9-]{36}/${BUCKET_FRAGMENT}/[a-f0-9-]{36}\\.[a-z0-9]{1,8}$`, 'i');

export function createMediaAssetsStore(pool, root) {
  function resolveWithinRoot(key) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 300) return null;
    if (isAbsolute(key) || key.includes('\0')) return null;
    const normalized = normalize(key);
    if (normalized.startsWith('..') || normalized.startsWith(sep) || isAbsolute(normalized)) return null;
    const absolute = resolve(root, normalized);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    return absolute;
  }

  function legacyPath(storagePath) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(storagePath)) return null;
    const absolute = join(root, storagePath);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    return absolute;
  }

  function storagePathFor(key) {
    return VALID_KEY.test(key) ? resolveWithinRoot(key) : legacyPath(key);
  }

  async function assertNoSymlink(absolutePath) {
    try {
      const real = await realpath(absolutePath);
      return real === absolutePath || real.startsWith(root + sep);
    } catch {
      return false;
    }
  }

  function sniffKind(buf, mime) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'image';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image';
    if (buf.toString('ascii', 4, 8) === 'ftyp') return mime === 'video/quicktime' || mime === 'video/mp4' ? 'video' : null;
    return null;
  }

  function validateUpload(filename, mime, size, bytes) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const isImage = IMAGE_MIMES.includes(mime) && IMAGE_EXTS.includes(ext);
    const isVideo = VIDEO_MIMES.includes(mime) && VIDEO_EXTS.includes(ext);
    if (!isImage && !isVideo) return { error: `Unsupported file type (${ext || 'unknown'}). Images: JPG, JPEG, PNG, WEBP. Videos: MP4, MOV.` };
    const type = isVideo ? 'video' : 'image';
    const cap = type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (size > cap || bytes.length > cap) return { error: `${filename}: ${type} too large. Max ${type === 'video' ? '50MB' : '10MB'}.` };
    const sniffed = sniffKind(bytes, mime);
    if (sniffed !== type) return { error: `${filename}: file content does not match its type. Please re-export and try again.` };
    return { type };
  }

  function sanitizeFilename(raw) {
    const base = String(raw || 'unnamed').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
    return base || 'unnamed';
  }

  async function measure(bytes, type) {
    if (type !== 'image') return { width: null, height: null };
    try {
      const meta = await sharp(bytes).metadata();
      return { width: meta.width ?? null, height: meta.height ?? null };
    } catch {
      return { width: null, height: null };
    }
  }

  const COLUMNS = 'id, user_id, filename, original_filename, type, mime, size, width, height, duration_ms, source, storage_path, thumbnail_path, alt_text, created_at, updated_at, expires_at, deleted_at';

  function hydrate(row) {
    return {
      id: row.id, userId: row.user_id || '', filename: row.filename, originalFilename: row.original_filename || row.filename,
      type: row.type, mime: row.mime, size: Number(row.size), width: row.width, height: row.height, durationMs: row.duration_ms,
      source: row.source, storageKey: row.storage_path, thumbnailKey: row.thumbnail_path, altText: row.alt_text,
      createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at, deletedAt: row.deleted_at,
    };
  }

  async function saveMediaAsset(params) {
    if (!params.userId) throw new Error('saveMediaAsset requires a userId');
    const safeName = sanitizeFilename(params.filename);
    const ext = (safeName.split('.').pop() || 'bin').toLowerCase();
    const source = params.source || 'UPLOAD';
    const bucket = BUCKETS[source] || 'other';
    const fileId = randomUUID();
    const key = `${params.userId}/${bucket}/${fileId}.${ext}`;
    const absolute = resolveWithinRoot(key);
    if (!absolute) throw new Error('Refusing to write outside the media storage directory');

    const type = ext === 'mp4' || ext === 'mov' ? 'video' : 'image';
    const measured = await measure(params.bytes, type);
    const width = params.width ?? measured.width;
    const height = params.height ?? measured.height;

    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, params.bytes, { flag: 'wx', mode: 0o600 });

    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + RETENTION_MS).toISOString();
    const rowId = randomUUID();

    try {
      await pool.query(
        `INSERT INTO media_assets
           (id, user_id, filename, original_filename, type, mime, size, width, height, duration_ms,
            source, storage_path, thumbnail_path, alt_text, created_at, updated_at, expires_at)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15)`,
        [rowId, params.userId, safeName, type, params.mime, params.bytes.length, width, height, params.durationMs ?? null, source, key, null, params.altText ?? null, createdAt, expiresAt],
      );
    } catch (err) {
      await unlink(absolute).catch(() => {});
      throw err;
    }

    return {
      id: rowId, userId: params.userId, filename: safeName, originalFilename: safeName, type, mime: params.mime,
      size: params.bytes.length, width, height, durationMs: params.durationMs ?? null, source,
      storageKey: key, thumbnailKey: null, altText: params.altText ?? null, createdAt, updatedAt: createdAt, expiresAt, deletedAt: null,
    };
  }

  async function listMediaAssets(userId, all = false) {
    const { rows } = all
      ? await pool.query(`SELECT ${COLUMNS} FROM media_assets WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000`)
      : await pool.query(`SELECT ${COLUMNS} FROM media_assets WHERE user_id = $1 AND deleted_at IS NULL AND expires_at > $2 ORDER BY created_at DESC LIMIT 1000`, [userId, new Date().toISOString()]);
    return rows.map(hydrate);
  }

  async function getMediaAsset(userId, id, opts = {}) {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM media_assets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND ($3::boolean OR expires_at > $4)`,
      [id, userId, !!opts.includeExpired, new Date().toISOString()],
    );
    return rows[0] ? hydrate(rows[0]) : null;
  }

  async function readMediaAssetBytes(asset) {
    const absolute = storagePathFor(asset.storageKey);
    if (!absolute) return null;
    if (!(await assertNoSymlink(absolute))) return null;
    try {
      const st = await stat(absolute);
      if (!st.isFile()) return null;
      return await readFile(absolute);
    } catch {
      return null;
    }
  }

  async function removeAssetFiles(asset) {
    for (const key of [asset.storageKey, asset.thumbnailKey]) {
      if (!key) continue;
      const absolute = storagePathFor(key);
      if (!absolute) continue;
      try { await unlink(absolute); } catch { /* already gone */ }
    }
  }

  async function deleteMediaAsset(userId, id, reason = 'USER_DELETED') {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await pool.query(
      `UPDATE media_assets SET deleted_at = $3, deleted_reason = $4, updated_at = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
      [id, userId, new Date().toISOString(), reason],
    );
    if (!rows[0]) return null;
    const asset = hydrate(rows[0]);
    await removeAssetFiles(asset);
    return asset;
  }

  function toPublicAsset(asset) {
    const { storageKey: _key, thumbnailKey: _thumb, ...rest } = asset;
    void _key; void _thumb;
    return rest;
  }

  // Faithful port of scripts/cleanup-expired-media.mjs's core loop (same
  // predicate, same soft-delete-then-unlink ordering, same "skip unsafe
  // key" refusal) — reusing this module's own resolveWithinRoot/legacyPath
  // instead of the script's duplicated copy, now that there's a real home
  // for it to import from. Never touches a row a post still references:
  // this only acts on rows already past expires_at, which saveMediaAsset
  // sets once at creation and nothing else extends — an asset an active
  // post still needs keeps showing in the gallery (not expired) until that
  // 30-day window is genuinely up, same as before this extraction.
  async function cleanupExpired({ dryRun = false, limit = 5000 } = {}) {
    const now = new Date();
    const { rows } = await pool.query(
      `SELECT id, storage_path, thumbnail_path FROM media_assets
        WHERE deleted_at IS NULL AND expires_at <= $1 ORDER BY expires_at ASC LIMIT $2`,
      [now.toISOString(), limit],
    );
    const summary = { scannedAt: now.toISOString(), dryRun, expired: rows.length, filesRemoved: 0, bytesReclaimed: 0, marked: 0, skippedUnsafeKey: 0, failures: 0 };
    for (const row of rows) {
      const resolved = [];
      for (const key of [row.storage_path, row.thumbnail_path].filter(Boolean)) {
        const abs = storagePathFor(key);
        if (!abs) { summary.skippedUnsafeKey++; continue; }
        resolved.push(abs);
      }
      if (dryRun) continue;
      for (const abs of resolved) {
        try {
          const st = await stat(abs);
          if (st.isFile()) { await unlink(abs); summary.filesRemoved++; summary.bytesReclaimed += st.size; }
        } catch { /* already gone */ }
      }
      try {
        const updated = await pool.query(
          `UPDATE media_assets SET deleted_at = $2, deleted_reason = 'EXPIRED', updated_at = $2 WHERE id = $1 AND deleted_at IS NULL`,
          [row.id, now.toISOString()],
        );
        summary.marked += updated.rowCount || 0;
      } catch { summary.failures++; }
    }
    return summary;
  }

  return { validateUpload, sanitizeFilename, saveMediaAsset, listMediaAssets, getMediaAsset, readMediaAssetBytes, deleteMediaAsset, toPublicAsset, cleanupExpired };
}
