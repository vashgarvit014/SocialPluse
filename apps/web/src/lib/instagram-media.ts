import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const directory = join(process.cwd(), '.instagram-media');
const lifetime = 24 * 60 * 60 * 1000;
const validId = /^[a-f0-9]{48}\.(jpg|mp4)$/;

export async function readInstagramMedia(id: string) {
  if (!validId.test(id)) return null;
  try {
    const path = join(directory, id);
    if (Date.now() - (await stat(path)).mtimeMs > lifetime) {
      await unlink(path);
      return null;
    }
    return await readFile(path);
  } catch { return null; }
}

// Created only by the publish route after resolving a connected account.
// Unguessable URLs let Meta fetch media without exposing a directory listing.
export async function prepareInstagramMedia(url: string, video = false): Promise<string> {
  if (!url.startsWith('data:')) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Instagram media must use a public HTTPS URL.');
    return parsed.href;
  }
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001');
  if (origin.protocol !== 'https:') throw new Error('Set NEXT_PUBLIC_APP_URL to your public HTTPS tunnel URL before publishing Instagram uploads.');
  const match = /^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
  if (!match || video !== match[1].startsWith('video/')) throw new Error('Use a PNG, JPEG or WebP image, or an MP4 video.');
  const limit = video ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
  if (match[2].length > Math.ceil(limit / 3) * 4) throw new Error('Instagram upload is too large (20 MB images / 100 MB videos).');
  let bytes = Buffer.from(match[2], 'base64');
  if (!video) {
    // A square canvas preserves the entire image and meets feed aspect limits.
    bytes = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .resize(1080, 1080, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  }
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) {
    if (!validId.test(name)) continue;
    const path = join(directory, name);
    try { if (Date.now() - (await stat(path)).mtimeMs > lifetime) await unlink(path); } catch { /* concurrent cleanup */ }
  }
  const id = `${randomBytes(24).toString('hex')}.${video ? 'mp4' : 'jpg'}`;
  await writeFile(join(directory, id), bytes, { flag: 'wx', mode: 0o600 });
  // Localhost-dev mirror: NEXT_PUBLIC_APP_URL points at the public domain,
  // which is served by the Docker app (different folder), NOT this dev
  // server — so Meta would 404 freshly staged bytes and the container lands
  // in ERROR ("could not process this media"). Best-effort copy the staged
  // file into the sibling Docker folder when present (override with
  // INSTAGRAM_MEDIA_MIRROR_DIR, empty to disable). Never throws.
  // Dev-only: skipped in production (the Docker image serves its own
  // .instagram-media). The /*turbopackIgnore: true*/ hints keep this dynamic,
  // parent-traversing path out of standalone output tracing — without them
  // Turbopack traces the whole project into .next/standalone.
  const mirrorDir = process.env.INSTAGRAM_MEDIA_MIRROR_DIR
    ?? join(/*turbopackIgnore: true*/ process.cwd(), '..', 'social-media-manager', '.instagram-media');
  if (mirrorDir && process.env.NODE_ENV !== 'production') {
    try {
      await mkdir(/*turbopackIgnore: true*/ mirrorDir, { recursive: true });
      await writeFile(join(/*turbopackIgnore: true*/ mirrorDir, id), bytes, { flag: 'wx', mode: 0o600 });
    } catch { /* mirror unavailable — production/single-folder setups don't need it */ }
  }
  return new URL(`/api/instagram/media/${id}`, origin).href;
}
