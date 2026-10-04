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
// Whapi reads the value as a fetchable URL. That created a trap: staging the
// bytes on OUR disk and advertising NEXT_PUBLIC_APP_URL only works when the
// server writing the file and the host serving the URL are the same machine.
// Running the app locally while NEXT_PUBLIC_APP_URL points at production meant
// Whapi fetched a URL the production container had never heard of -> 404 ->
// "media link is not available". Two `.jpg` files in a local .whapi-media/
// directory were the entire evidence.
//
// The fix is to stop needing a publicly reachable copy of our own filesystem.
// This gateway accepts a raw binary body:
//
//   POST /media            Content-Type: image/png   <bytes>
//     -> 200 {"media":[{"id":"png-<uuid>"}]}
//   GET  /media
//     -> {"files":[{"id":"png-<uuid>", "link":"https://…/in-files/png-<uuid>"}]}
//
// The returned `link` is a public object URL (verified fetchable with no auth),
// which is exactly what the messages API wants. Disk staging is kept only as a
// fallback so production behaviour is unchanged if the upload API is ever absent.

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

export interface WhapiChannel {
  baseUrl: string;
  token: string;
}

/**
 * Uploads raw bytes to Whapi and returns the public link for them.
 *
 * The link comes from the API's own /media listing rather than a URL we
 * assemble ourselves, so a change in their storage layout cannot silently
 * produce 404s again.
 */
async function uploadToWhapi(bytes: Buffer, mime: string, channel: WhapiChannel): Promise<string> {
  const base = channel.baseUrl.replace(/\/+$/, '');
  const upload = await fetch(`${base}/media`, {
    method: 'POST',
    headers: { 'Content-Type': mime, Authorization: `Bearer ${channel.token}` },
    body: new Uint8Array(bytes),
  });
  if (!upload.ok) {
    const raw = await upload.text().catch(() => '');
    throw new Error(`WhatsApp media upload failed (HTTP ${upload.status}): ${raw.slice(0, 200)}`);
  }
  const created = await upload.json().catch(() => null) as { media?: Array<{ id?: string }> } | null;
  const id = created?.media?.[0]?.id;
  if (!id) throw new Error('WhatsApp media upload returned no media id.');

  // Resolve the public link from the API's own listing.
  const listRes = await fetch(`${base}/media`, { headers: { Authorization: `Bearer ${channel.token}` } });
  if (listRes.ok) {
    const list = await listRes.json().catch(() => null) as { files?: Array<{ id?: string; link?: string }> } | null;
    const match = list?.files?.find((f) => f.id === id && f.link);
    if (match?.link) return match.link;
  }
  // Their listing did not surface a link; fall back to their own media path.
  return `${base}/media/${id}`;
}

// Returns an absolute https URL (or media reference) Whapi can fetch.
// Absolute https inputs pass through untouched; data: URLs are uploaded to
// Whapi, falling back to local staging only if the upload API is unavailable.
export async function prepareWhapiMedia(url: string, channel: WhapiChannel): Promise<string> {
  if (!url.startsWith('data:')) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('WhatsApp media must be a public HTTPS URL or a data URL.');
    }
    return parsed.href;
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

  // Preferred path: hand the bytes straight to Whapi. No public URL of our own
  // is involved, so this behaves identically on localhost and in production.
  try {
    return await uploadToWhapi(bytes, mime, channel);
  } catch (error) {
    console.error('[whapi-media] upload to Whapi failed, falling back to local staging:',
      error instanceof Error ? error.message : error);
  }

  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001');
  if (origin.protocol !== 'https:') {
    throw new Error('WhatsApp media upload is unavailable and NEXT_PUBLIC_APP_URL is not a public HTTPS URL, so the image cannot be sent.');
  }
  await mkdir(DIRECTORY, { recursive: true });
  await sweep();
  const id = `${randomBytes(24).toString('hex')}.${ext}`;
  await writeFile(join(DIRECTORY, id), bytes, { flag: 'wx', mode: 0o600 });
  return new URL(`/api/whapi/media/${id}`, origin).href;
}
