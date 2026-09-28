import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { query } from '@/lib/db';

// Persistent asset library backing /asset-gallery direct uploads. Files live
// under .media-assets/ (bind-mounted in docker-compose like .instagram-media
// so they survive container recreation); only metadata + the random storage
// id live in Postgres. Reuses the project's existing client-side limits
// (10MB images / 50MB videos, see handleUploadImage) — the server enforces
// the same caps independently, never trusting the client.
const directory = join(process.cwd(), '.media-assets');

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXTS = ['mp4', 'mov'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const validId = /^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|mp4|mov)$/;

export type MediaAssetType = 'image' | 'video';
export type MediaAssetSource = 'UPLOAD' | 'AI' | 'CANVA' | 'BRANDED' | 'SESSION';

export interface MediaAsset {
  id: string;
  filename: string;
  type: MediaAssetType;
  mime: string;
  size: number;
  source: MediaAssetSource;
  createdAt: string;
  updatedAt: string;
}

// Basename + safe charset only — kills path traversal (../../etc) and shell
// metacharacters. Stored files never use this name on disk anyway (random
// id), it is display metadata only.
export function sanitizeFilename(raw: string): string {
  const base = basename(String(raw || 'unnamed')).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'unnamed';
  return base;
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

export function validateUpload(filename: string, mime: string, size: number, bytes: Buffer): { type: MediaAssetType; error?: undefined } | { type?: undefined; error: string } {
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

export async function saveMediaAsset(params: {
  userId: string; filename: string; mime: string; bytes: Buffer; source?: MediaAssetSource;
}): Promise<MediaAsset> {
  const safeName = sanitizeFilename(params.filename);
  const ext = (safeName.split('.').pop() || 'bin').toLowerCase();
  const storageId = `${randomUUID()}.${ext}`;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, storageId), params.bytes, { flag: 'wx', mode: 0o600 });
  const now = new Date().toISOString();
  const source = params.source || 'UPLOAD';
  const type: MediaAssetType = ext === 'mp4' || ext === 'mov' ? 'video' : 'image';
  const rowId = randomUUID();
  await query(
    `INSERT INTO media_assets (id, user_id, filename, type, mime, size, source, storage_path, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [rowId, params.userId, safeName, type, params.mime, params.bytes.length, source, storageId, now],
  );
  return {
    id: rowId, filename: safeName, type, mime: params.mime,
    size: params.bytes.length, source, createdAt: now, updatedAt: now,
  };
}

export async function listMediaAssets(userId: string, all = false): Promise<MediaAsset[]> {
  const rows = all
    ? await query<{ id: string; filename: string; type: MediaAssetType; mime: string; size: number; source: MediaAssetSource; created_at: string; updated_at: string }>(
      'SELECT id, filename, type, mime, size, source, created_at, updated_at FROM media_assets ORDER BY created_at DESC LIMIT 500')
    : await query<{ id: string; filename: string; type: MediaAssetType; mime: string; size: number; source: MediaAssetSource; created_at: string; updated_at: string }>(
      'SELECT id, filename, type, mime, size, source, created_at, updated_at FROM media_assets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500', [userId]);
  return rows.map(r => ({
    id: r.id, filename: r.filename, type: r.type, mime: r.mime, size: Number(r.size),
    source: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export async function getMediaAsset(id: string): Promise<{ asset: MediaAsset & { userId: string }; bytes: Buffer } | null> {
  const rows = await query<{ id: string; user_id: string; filename: string; type: MediaAssetType; mime: string; size: number; source: MediaAssetSource; storage_path: string; created_at: string; updated_at: string }>(
    'SELECT * FROM media_assets WHERE id = $1', [id]);
  const r = rows[0];
  if (!r || !validId.test(r.storage_path)) return null;
  try {
    const bytes = await readFile(join(directory, r.storage_path));
    return {
      asset: {
        id: r.id, userId: r.user_id, filename: r.filename, type: r.type, mime: r.mime,
        size: Number(r.size), source: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
      },
      bytes,
    };
  } catch {
    return null;
  }
}

export async function deleteMediaAsset(id: string): Promise<boolean> {
  const rows = await query<{ storage_path: string }>('SELECT storage_path FROM media_assets WHERE id = $1', [id]);
  const r = rows[0];
  if (!r) return false;
  await query('DELETE FROM media_assets WHERE id = $1', [id]);
  if (r.storage_path && validId.test(r.storage_path)) {
    try {
      const st = await stat(join(directory, r.storage_path));
      if (st.isFile()) await unlink(join(directory, r.storage_path));
    } catch { /* already gone */ }
  }
  return true;
}
