import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { query, queryOne } from '@/lib/db';

// Persistent, per-user asset library backing /asset-gallery.
//
// Two properties this module exists to guarantee:
//
//   1. OWNERSHIP. Every row carries user_id and every read filters on it. A
//      caller asks for (userId, assetId) — there is deliberately no by-id-only
//      lookup, because that shape is the IDOR that let any user preview any
//      other user's media through a guessed URL.
//
//   2. RETENTION. Every persisted asset gets expires_at = created_at + 30 days.
//      The Asset Gallery only ever lists active rows (not deleted, not
//      expired). Expiry never deletes a file inline: it hides the row, and the
//      background cleanup job (scripts/cleanup-expired-media.ts, or
//      `npm run cleanup:expired-media`) reclaims the bytes afterwards. That
//      ordering means a user's request never stalls on a disk unlink, and a
//      retry after a crash is harmless.
//
// Files live under .media-assets/ (bind-mounted in docker-compose so they
// survive container recreation) in a user-namespaced layout:
//
//     .media-assets/<userId>/<bucket>/<randomId>.<ext>
//
// The namespace is what keeps two users' identically-named uploads from
// colliding and makes an accidental cross-user read structurally impossible.

const root = join(process.cwd(), '.media-assets');

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXTS = ['mp4', 'mov'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** User media is retained for 30 days from creation. */
export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Canonical source values written by this app. The DB CHECK also still admits
// the pre-migration values ('AI', 'CANVA', 'SESSION') because existing rows
// carry them; new writes always use this set.
export type MediaAssetSource = 'UPLOAD' | 'AI_GENERATED' | 'CANVA_IMPORT' | 'BRANDED' | 'CAROUSEL' | 'OTHER';
export type MediaAssetType = 'image' | 'video';

export interface MediaAsset {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  type: MediaAssetType;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  source: MediaAssetSource | string;
  storageKey: string;
  thumbnailKey: string | null;
  altText: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  deletedAt: string | null;
}

/** Storage bucket per source, so a directory listing is self-explanatory. */
const BUCKETS: Record<string, string> = {
  UPLOAD: 'uploads',
  AI_GENERATED: 'generated',
  AI: 'generated',
  CANVA_IMPORT: 'canva',
  CANVA: 'canva',
  BRANDED: 'branded',
  CAROUSEL: 'carousels',
  OTHER: 'other',
  SESSION: 'other',
};

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// NOTE: the bucket fragment below must be UNANCHORED. Composing a regex from
// another regex's `.source` embeds that regex's own ^ and $, producing a
// pattern that can never match — which silently made every stored asset
// unreadable (uploads succeeded, then every fetch 404'd).
const BUCKET_FRAGMENT = '[a-z][a-z0-9_-]{0,31}';
const VALID_KEY = new RegExp(
  `^[a-f0-9-]{36}/${BUCKET_FRAGMENT}/[a-f0-9-]{36}\\.[a-z0-9]{1,8}$`,
  'i',
);

/**
 * Resolves a storage key to an absolute path, or null if it would escape the
 * media root.
 *
 * The key is validated against a strict pattern AND the resolved path is
 * re-checked with path.relative, so a CRAFTED key cannot reach outside
 * .media-assets/. That part is a hard boundary: the cleanup job walks keys
 * taken from the database and unlinks them, and no caller can invent a key.
 *
 * Note honestly what this does NOT cover: path.relative is lexical, so it says
 * nothing about symlinks. No symlink can be created through the API (the only
 * writer is writeFile(..., { flag: 'wx' }) with a randomUUID name), so the
 * attacker would need pre-existing filesystem access — at which point they can
 * simply delete files directly. assertNoSymlink() adds realpath verification
 * anyway, because the read path hands bytes to an HTTP client and that
 * deserves defence in depth rather than an argument.
 */
export function resolveWithinRoot(key: string): string | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > 300) return null;
  if (isAbsolute(key) || key.includes('\0')) return null;
  const normalized = normalize(key);
  if (normalized.startsWith('..') || normalized.startsWith(sep) || isAbsolute(normalized)) return null;
  const absolute = resolve(root, normalized);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
}

/** Legacy rows stored a bare filename in a flat directory; still readable. */
function legacyPath(storagePath: string): string | null {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(storagePath)) return null;
  const absolute = join(root, storagePath);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
}

export function storagePathFor(key: string): string | null {
  return VALID_KEY.test(key) ? resolveWithinRoot(key) : legacyPath(key);
}

/**
 * Final symlink guard for the READ path. Returns null (refuse to serve) when
 * any component between the media root and the file is a symlink, so a link
 * planted on disk cannot make the asset endpoint serve a file from outside
 * .media-assets/.
 *
 * Write and delete are already safe: writeFile uses an exclusive random name,
 * and unlink removes the link itself rather than following it.
 */
export async function assertNoSymlink(absolutePath: string): Promise<boolean> {
  try {
    const real = await realpath(absolutePath);
    return real === absolutePath || real.startsWith(root + sep);
  } catch {
    // Path does not exist (or is unreadable) — nothing to serve.
    return false;
  }
}

// Basename + safe charset only — kills path traversal (../../etc) and shell
// metacharacters. Stored files never use this name on disk anyway (random
// id), it is display metadata only.
export function sanitizeFilename(raw: string): string {
  const base = String(raw || 'unnamed').split(/[\\/]/).pop()!.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return base || 'unnamed';
}

function sniffKind(buf: Buffer, mime: string): MediaAssetType | null {
  // Magic bytes first (client mime is a hint, never proof).
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image'; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image'; // PNG
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image'; // WEBP
  // MP4/MOV: 'ftyp' box at offset 4.
  if (buf.toString('ascii', 4, 8) === 'ftyp') return mime === 'video/quicktime' || mime === 'video/mp4' ? 'video' : null;
  return null;
}

export function validateUpload(
  filename: string,
  mime: string,
  size: number,
  bytes: Buffer,
): { type: MediaAssetType; error?: undefined } | { type?: undefined; error: string } {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const isImage = IMAGE_MIMES.includes(mime) && IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_MIMES.includes(mime) && VIDEO_EXTS.includes(ext);
  if (!isImage && !isVideo) {
    return { error: `Unsupported file type (${ext || 'unknown'}). Images: JPG, JPEG, PNG, WEBP. Videos: MP4, MOV.` };
  }
  const type: MediaAssetType = isVideo ? 'video' : 'image';
  const cap = type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > cap || bytes.length > cap) {
    return { error: `${filename}: ${type} too large. Max ${type === 'video' ? '50MB' : '10MB'}.` };
  }
  // Extension allowlist blocks executables (.js/.html/.svg/scripts) by
  // construction — nothing outside the two lists above is storable.
  const sniffed = sniffKind(bytes, mime);
  if (sniffed !== type) {
    return { error: `${filename}: file content does not match its type. Please re-export and try again.` };
  }
  return { type };
}

/** Reads intrinsic dimensions without failing the save if the codec surprises us. */
async function measure(bytes: Buffer, type: MediaAssetType): Promise<{ width: number | null; height: number | null }> {
  if (type !== 'image') return { width: null, height: null };
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(bytes).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

interface AssetRow {
  id: string;
  user_id: string | null;
  filename: string;
  original_filename: string | null;
  type: MediaAssetType;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  source: string;
  storage_path: string;
  thumbnail_path: string | null;
  alt_text: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  deleted_at: string | null;
}

const COLUMNS = 'id, user_id, filename, original_filename, type, mime, size, width, height, duration_ms, source, storage_path, thumbnail_path, alt_text, created_at, updated_at, expires_at, deleted_at';

function hydrate(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    userId: row.user_id || '',
    filename: row.filename,
    originalFilename: row.original_filename || row.filename,
    type: row.type,
    mime: row.mime,
    size: Number(row.size),
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    source: row.source,
    storageKey: row.storage_path,
    thumbnailKey: row.thumbnail_path,
    altText: row.alt_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
  };
}

export async function saveMediaAsset(params: {
  userId: string;
  filename: string;
  mime: string;
  bytes: Buffer;
  source?: MediaAssetSource | string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  altText?: string | null;
}): Promise<MediaAsset> {
  if (!params.userId) throw new Error('saveMediaAsset requires a userId');

  const safeName = sanitizeFilename(params.filename);
  const ext = (safeName.split('.').pop() || 'bin').toLowerCase();
  const source = params.source || 'UPLOAD';
  const bucket = BUCKETS[source] || 'other';
  const fileId = randomUUID();
  const key = `${params.userId}/${bucket}/${fileId}.${ext}`;
  const absolute = resolveWithinRoot(key);
  if (!absolute) throw new Error('Refusing to write outside the media storage directory');

  const type: MediaAssetType = ext === 'mp4' || ext === 'mov' ? 'video' : 'image';
  const measured = await measure(params.bytes, type);
  const width = params.width ?? measured.width;
  const height = params.height ?? measured.height;

  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  // 'wx' fails rather than overwriting: with a random id a collision is
  // impossible, so a hit means something is wrong and we must not clobber.
  await writeFile(absolute, params.bytes, { flag: 'wx', mode: 0o600 });

  const now = new Date();
  const createdAt = now.toISOString();
  // The 30-day retention window starts at creation, for every source: AI
  // generations, uploads, Canva imports, branded variants and carousel media
  // alike.
  const expiresAt = new Date(now.getTime() + RETENTION_MS).toISOString();
  const rowId = randomUUID();

  try {
    await query(
      `INSERT INTO media_assets
         (id, user_id, filename, original_filename, type, mime, size, width, height, duration_ms,
          source, storage_path, thumbnail_path, alt_text, created_at, updated_at, expires_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15)`,
      [
        rowId,
        params.userId,
        safeName,
        type,
        params.mime,
        params.bytes.length,
        width,
        height,
        params.durationMs ?? null,
        source,
        key,
        null,
        params.altText ?? null,
        createdAt,
        expiresAt,
      ],
    );
  } catch (err) {
    // Never leave an orphaned file behind if the row could not be written.
    await unlink(absolute).catch(() => {});
    throw err;
  }

  return {
    id: rowId,
    userId: params.userId,
    filename: safeName,
    originalFilename: safeName,
    type,
    mime: params.mime,
    size: params.bytes.length,
    width,
    height,
    durationMs: params.durationMs ?? null,
    source,
    storageKey: key,
    thumbnailKey: null,
    altText: params.altText ?? null,
    createdAt,
    updatedAt: createdAt,
    expiresAt,
    deletedAt: null,
  };
}

/**
 * The Asset Gallery list: ACTIVE assets for this user only.
 *
 *   user_id = $1 AND deleted_at IS NULL AND expires_at > now()
 *
 * newest first. Rows with a NULL user_id (imported from before ownership
 * existed) never match, so legacy media stays invisible to normal users and
 * reachable only through the Superadmin cross-user view.
 */
export async function listMediaAssets(userId: string, all = false): Promise<MediaAsset[]> {
  const rows = all
    ? await query<AssetRow>(
        `SELECT ${COLUMNS} FROM media_assets WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000`,
      )
    : await query<AssetRow>(
        `SELECT ${COLUMNS} FROM media_assets
          WHERE user_id = $1 AND deleted_at IS NULL AND expires_at > $2
          ORDER BY created_at DESC LIMIT 1000`,
        [userId, new Date().toISOString()],
      );
  return rows.map(hydrate);
}

/**
 * Single-asset fetch, ALWAYS owner-scoped.
 *
 * There is no variant that resolves an asset by id alone: a caller that wants
 * someone else's file must go through a Superadmin check that does not exist
 * on this path. Rows that are deleted or expired are treated as absent so a
 * stale link stops resolving the moment its window closes.
 */
export async function getMediaAsset(userId: string, id: string, opts: { includeExpired?: boolean } = {}): Promise<MediaAsset | null> {
  if (!UUID_RE.test(id)) return null;
  const row = await queryOne<AssetRow>(
    `SELECT ${COLUMNS} FROM media_assets
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        AND ($3::boolean OR expires_at > $4)`,
    [id, userId, !!opts.includeExpired, new Date().toISOString()],
  );
  return row ? hydrate(row) : null;
}

/** Reads an asset's bytes after ownership has been verified by getMediaAsset. */
export async function readMediaAssetBytes(asset: MediaAsset): Promise<Buffer | null> {
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

/**
 * Soft delete: hides the row from the gallery and unlinks the bytes.
 *
 * The DB row is kept (deleted_at set) rather than removed so the event can be
 * audited and so a user's "delete" is distinguishable from an expiry. File
 * removal is best-effort — if it fails, the cleanup job can reclaim it later,
 * and a stranded file is far better than a live row pointing at nothing.
 */
export async function deleteMediaAsset(userId: string, id: string, reason: 'USER_DELETED' | 'EXPIRED' = 'USER_DELETED'): Promise<MediaAsset | null> {
  if (!UUID_RE.test(id)) return null;
  const row = await queryOne<AssetRow>(
    `UPDATE media_assets SET deleted_at = $3, deleted_reason = $4, updated_at = $3
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, userId, new Date().toISOString(), reason],
  );
  if (!row) return null;
  const asset = hydrate(row);
  await removeAssetFiles(asset);
  return asset;
}

/** Unlinks the asset and its thumbnail, refusing any path outside the root. */
export async function removeAssetFiles(asset: Pick<MediaAsset, 'storageKey' | 'thumbnailKey'>): Promise<void> {
  for (const key of [asset.storageKey, asset.thumbnailKey]) {
    if (!key) continue;
    const absolute = storagePathFor(key);
    if (!absolute) continue;
    try {
      await unlink(absolute);
    } catch { /* already gone — nothing to reclaim */ }
  }
}

/**
 * The shape a browser is allowed to see.
 *
 * storageKey/thumbnailKey are server-internal paths. They are stripped here
 * rather than filtered per route so no user-facing endpoint can leak the
 * on-disk layout (which namespaces by userId) by forgetting to omit them.
 */
export type PublicMediaAsset = Omit<MediaAsset, 'storageKey' | 'thumbnailKey'>;

export function toPublicAsset(asset: MediaAsset): PublicMediaAsset {
  const { storageKey: _key, thumbnailKey: _thumb, ...rest } = asset;
  void _key; void _thumb;
  return rest;
}

/** Days until an asset expires; negative once it has. Used by the gallery UI. */
export function daysUntilExpiry(asset: Pick<MediaAsset, 'expiresAt'>, now = Date.now()): number {
  return Math.ceil((Date.parse(asset.expiresAt) - now) / (24 * 60 * 60 * 1000));
}

export { root as mediaRoot, BUCKETS as MEDIA_BUCKETS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES };