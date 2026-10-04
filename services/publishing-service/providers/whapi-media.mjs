// Faithful port of src/lib/whapi-media.ts. Same upload-to-Whapi-first,
// local-staging-fallback behavior; same shared .whapi-media/ directory
// approach as instagram-media.mjs above.

import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const LIFETIME_MS = 60 * 60 * 1000;
const VALID_ID = /^[a-f0-9]{48}\.(png|jpg|webp|mp4|pdf)$/;
const KIND_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };

async function sweep(directory) {
  try {
    for (const name of await readdir(directory)) {
      if (!VALID_ID.test(name)) continue;
      const path = join(directory, name);
      try {
        if (Date.now() - (await stat(path)).mtimeMs > LIFETIME_MS) await unlink(path);
      } catch { /* concurrent cleanup */ }
    }
  } catch { /* directory not created yet */ }
}

async function uploadToWhapi(bytes, mime, channel) {
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
  const created = await upload.json().catch(() => null);
  const id = created?.media?.[0]?.id;
  if (!id) throw new Error('WhatsApp media upload returned no media id.');
  const listRes = await fetch(`${base}/media`, { headers: { Authorization: `Bearer ${channel.token}` } });
  if (listRes.ok) {
    const list = await listRes.json().catch(() => null);
    const match = list?.files?.find((f) => f.id === id && f.link);
    if (match?.link) return match.link;
  }
  return `${base}/media/${id}`;
}

export function createWhapiMediaStager(directory, appOrigin) {
  return async function prepareWhapiMedia(url, channel) {
    if (!url.startsWith('data:')) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('WhatsApp media must be a public HTTPS URL or a data URL.');
      return parsed.href;
    }
    const match = /^data:((?:image\/(?:png|jpeg|webp)|video\/mp4|application\/pdf));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
    if (!match) throw new Error('WhatsApp media must be a PNG, JPEG or WebP image, an MP4 video, or a PDF document.');
    const mime = match[1].toLowerCase();
    const ext = KIND_BY_MIME[mime];
    if (!ext) throw new Error('Unsupported WhatsApp media type. Use PNG, JPEG, WebP, MP4 or PDF.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0) throw new Error('WhatsApp media is empty.');

    try {
      return await uploadToWhapi(bytes, mime, channel);
    } catch (error) {
      console.error('[whapi-media] upload to Whapi failed, falling back to local staging:', error instanceof Error ? error.message : error);
    }

    const origin = new URL(appOrigin || 'http://localhost:3001');
    if (origin.protocol !== 'https:') throw new Error('WhatsApp media upload is unavailable and NEXT_PUBLIC_APP_URL is not a public HTTPS URL, so the image cannot be sent.');
    await mkdir(directory, { recursive: true });
    await sweep(directory);
    const id = `${randomBytes(24).toString('hex')}.${ext}`;
    await writeFile(join(directory, id), bytes, { flag: 'wx', mode: 0o600 });
    return new URL(`/api/whapi/media/${id}`, origin).href;
  };
}
