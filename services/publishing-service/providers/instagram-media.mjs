// Faithful port of src/lib/instagram-media.ts's WRITE side (prepareInstagramMedia).
// The READ side (GET /api/instagram/media/[id], served to Meta) deliberately
// stays in the monolith — this service only needs to WRITE into the same
// bind-mounted .instagram-media/ directory the monolith already serves from
// (see docker-compose.yml), same "share the real directory" approach used
// for media-service's .media-assets. The dev-only mirror-copy branch is not
// ported — that was a local-dev convenience for a two-folder setup, not
// relevant to a containerized service.

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export function createInstagramMediaStager(directory, appOrigin) {
  return async function prepareInstagramMedia(url, video = false) {
    if (!url.startsWith('data:')) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('Instagram media must use a public HTTPS URL.');
      return parsed.href;
    }
    const origin = new URL(appOrigin || 'http://localhost:3001');
    if (origin.protocol !== 'https:') throw new Error('Set NEXT_PUBLIC_APP_URL to your public HTTPS tunnel URL before publishing Instagram uploads.');
    const match = /^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
    if (!match || video !== match[1].startsWith('video/')) throw new Error('Use a PNG, JPEG or WebP image, or an MP4 video.');
    const limit = video ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
    if (match[2].length > Math.ceil(limit / 3) * 4) throw new Error('Instagram upload is too large (20 MB images / 100 MB videos).');
    let bytes = Buffer.from(match[2], 'base64');
    if (!video) {
      bytes = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
        .resize(1080, 1080, { fit: 'contain', background: '#ffffff' })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    }
    await mkdir(directory, { recursive: true });
    const id = `${randomBytes(24).toString('hex')}.${video ? 'mp4' : 'jpg'}`;
    await writeFile(join(directory, id), bytes, { flag: 'wx', mode: 0o600 });
    return new URL(`/api/instagram/media/${id}`, origin).href;
  };
}
