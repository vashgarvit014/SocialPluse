import 'server-only';
import { mkdir, writeFile, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';

// Whapi's POST /messages/{image,video,document} does NOT accept base64 or
// data: URLs in the `media` field — verified against the live API:
//
//   media: "<raw base64>" + mime_type -> 404 "media with specified id not found"
//   media: "data:image/png;base64,..."  -> 500 "bad-request"
//   media: "https://.../file.png"       -> passes media resolution
//
// Whapi reads the value as a fetchable URL (or a media id from their own
// upload API). So a data: URL has to be staged on disk and served over public
// HTTPS first, exactly like the Instagram path in src/lib/instagram-media.ts —
// unguessable id, no directory listing, and a lifetime sweep so staged media
// cannot accumulate.

const DIRECTORY = join(process.cwd(), '.whapi-media');
const LIFETIME_MS = 60 * 60 * 1000; // 1 hour
const VALID_ID = /^[a-f0-9]{48}\.(png|jpg|webp|mp4|pdf)$/;

const KIND_BY_MIME: Record<string, 'png' | 'jpg' | 'webp' | 'mp4' | 'pdf'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

async function sweep() {
  try {
    for (const name of await readdir(DIRECTORY)) {
      if (!VALID_ID.test(name)) continue;
      const path = join(DIRECTORY, name);
      try {
        if (Date.now() - (await stat(path)).mtimeMs > LIFETIME_MS) await unlink(path);
      } catch { /* concurrent cleanup — harmless */ }
    }
  } catch { /* directory not created yet */ }
}

// Returns an absolute https URL Whapi can fetch. Absolute https inputs are
// passed through untouched; data: URLs are staged on disk.
export async function prepareWhapiMedia(url: string): Promise<string> {
  if (!url.startsWith('data:')) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('WhatsApp media must be a public HTTPS URL or a data URL.');
    }
    return parsed.href;
  }

  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001');
  if (origin.protocol !== 'https:') {
    throw new Error('Set NEXT_PUBLIC_APP_URL to your public HTTPS tunnel URL before publishing WhatsApp media.');
  }

  const match = /^data:((?:image\/(?:png|jpeg|webp)|video\/mp4|application\/pdf));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
  if (!match) {
    throw new Error('WhatsApp media must be a PNG, JPEG or WebP image, an MP4 video, or a PDF document.');
  }
  const mime = match[1].toLowerCase();
  const ext = KIND_BY_MIME[mime];
  if (!ext) throw new Error('Unsupported WhatsApp media type. Use PNG, JPEG, WebP, MP4 or PDF.');

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) throw new Error('WhatsApp media is empty.');

  await mkdir(DIRECTORY, { recursive: true });
  await sweep();
  const id = `${randomBytes(24).toString('hex')}.${ext}`;
  await writeFile(join(DIRECTORY, id), bytes, { flag: 'wx', mode: 0o600 });

  return new URL(`/api/whapi/media/${id}`, origin).href;
}
