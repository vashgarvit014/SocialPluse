// Faithful port of src/app/api/whapi/publish/route.ts's publishing logic
// (text/image/video/document to groups/communities/chats). Ownership gate
// and duplicate guard are handled by the caller (src/server.mjs) via
// credentials.mjs/idempotency.mjs — this module is the actual send logic.
import { whapiFetch, whapiError } from './whapi-client.mjs';

function isSendableTarget(id) {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length < 10 || trimmed.length > 40) return false;
  return /@(g\.us|s\.whatsapp\.net|lid)$/.test(trimmed);
}
function isGroupTarget(id) {
  return /@g\.us$/.test(id.trim());
}
function splitDataUrl(url) {
  const m = /^data:([^;,]+)?(?:;[^;,]+)*;base64,([\s\S]+)$/.exec(url.trim());
  if (!m) return null;
  return { raw: m[2].replace(/\s+/g, ''), mime: m[1] || '' };
}
function mediaFields(url, fallbackMime) {
  const parts = splitDataUrl(url);
  if (!parts) return { media: url };
  return { media: parts.raw, mime_type: parts.mime || fallbackMime };
}

const ANNOUNCE_RETRY_DELAY_MS = 4000;
async function sendAllowingAnnouncePropagation(send) {
  const first = await send();
  if (first.status !== 403) return first;
  const firstBody = await first.text().catch(() => '');
  if (!/group-announce-not-admin/i.test(firstBody)) return new Response(firstBody, { status: first.status, headers: first.headers });
  console.warn(`[publishing-service] whapi announcement group refused the first attempt; retrying in ${ANNOUNCE_RETRY_DELAY_MS}ms while WhatsApp propagates the admin grant`);
  await new Promise((r) => setTimeout(r, ANNOUNCE_RETRY_DELAY_MS));
  const second = await send();
  if (second.status === 403) {
    const secondBody = await second.text().catch(() => '');
    return new Response(secondBody, { status: second.status, headers: second.headers });
  }
  return second;
}

async function validateGroupExists(groupId, baseUrl, token) {
  const PAGE = 100;
  const MAX_PAGES = 20;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE;
      const res = await whapiFetch(`/groups?count=${PAGE}&offset=${offset}`, token, { method: 'GET' }, baseUrl);
      if (!res.ok) return { valid: true };
      const data = await res.json().catch(() => ({}));
      const groups = Array.isArray(data.groups) ? data.groups : [];
      if (groups.some((g) => g.id === groupId)) return { valid: true };
      if (groups.length < PAGE) break;
      if (typeof data.total === 'number' && offset + groups.length >= data.total) break;
    }
    return { valid: false, error: `Group ${groupId} not found in connected Whapi channel groups.` };
  } catch {
    return { valid: true };
  }
}

export async function publishToWhapi({ config, groupId, text, mediaList, attempt, prepareWhapiMedia }) {
  if (!groupId || !groupId.trim()) return { ok: false, code: 'WHAPI_GROUP_NOT_FOUND', message: 'A valid groupId is required.', status: 400 };
  const cleanGroupId = groupId.trim();
  if (!isSendableTarget(cleanGroupId)) return { ok: false, code: 'WHAPI_GROUP_NOT_FOUND', message: 'That WhatsApp destination is not a valid chat or group. Refresh the destination list and pick another.', status: 400 };

  if (isGroupTarget(cleanGroupId)) {
    const validation = await validateGroupExists(cleanGroupId, config.baseUrl, config.token);
    if (!validation.valid) return { ok: false, code: 'WHAPI_GROUP_NOT_FOUND', message: validation.error || 'That WhatsApp group is no longer available to this number. Refresh the destination list and pick another.', status: 404 };
  }

  const caption = typeof text === 'string' ? text.trim() : '';
  const list = Array.isArray(mediaList) ? mediaList.filter((m) => m && typeof m.url === 'string' && m.url.length > 0) : [];
  if (!caption && list.length === 0) return { ok: false, code: 'WHAPI_BAD_REQUEST', message: 'Either text or media is required.', status: 400 };
  if (list.length > 1) console.warn(`[publishing-service] whapi multiple media (${list.length}) received, sending first only (attempt ${attempt})`);

  const firstMedia = list[0];
  const hasMedia = !!firstMedia;

  try {
    if (!hasMedia) {
      const payload = { to: cleanGroupId, body: caption };
      const res = await sendAllowingAnnouncePropagation(() => whapiFetch('/messages/text', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl));
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const mapped = whapiError(res.status, errBody, 'sending text');
        const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : res.status === 403 ? 'WHAPI_PERMISSION_DENIED' : 'WHAPI_PUBLISH_FAILED';
        const status = [400, 401, 402, 403, 429].includes(res.status) ? res.status : 502;
        return { ok: false, code, message: mapped.message, status };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, message: 'Message sent to WhatsApp group.', data };
    }

    const url = firstMedia.url;
    const type = firstMedia.type === 'video' ? 'video' : firstMedia.type === 'image' ? 'image' : url.startsWith('data:video/') ? 'video' : 'image';
    const isVideo = type === 'video';
    const isDocument = firstMedia.type === 'document' || (!isVideo && !url.startsWith('data:image/') && !url.startsWith('data:video/') && !!firstMedia.name);

    let mediaValue;
    try {
      mediaValue = await prepareWhapiMedia(url, { baseUrl: config.baseUrl, token: config.token });
    } catch (e) {
      return { ok: false, code: 'WHAPI_UNSUPPORTED_MEDIA', message: e instanceof Error ? e.message : 'This media cannot be published to WhatsApp.', status: 400 };
    }

    if (isDocument) {
      const filename = firstMedia.name || 'document.pdf';
      const ext = (filename.split('.').pop() || '').toLowerCase();
      const docMime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
      const payload = { to: cleanGroupId, ...mediaFields(mediaValue, docMime), caption: caption || undefined, filename };
      const res = await sendAllowingAnnouncePropagation(() => whapiFetch('/messages/document', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl));
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (res.status === 400 && /unsupported/i.test(errBody)) return { ok: false, code: 'WHAPI_UNSUPPORTED_MEDIA', message: 'Document not supported by Whapi for this channel.', status: 400 };
        const mapped = whapiError(res.status, errBody, 'sending document');
        const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : 'WHAPI_PUBLISH_FAILED';
        const status = [400, 401, 402, 403, 429].includes(res.status) ? res.status : 502;
        return { ok: false, code, message: mapped.message, status };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, message: 'Document sent to WhatsApp group.', data };
    }

    if (isVideo) {
      const payload = { to: cleanGroupId, ...mediaFields(mediaValue, 'video/mp4'), caption: caption || undefined };
      const res = await sendAllowingAnnouncePropagation(() => whapiFetch('/messages/video', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl));
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const mapped = whapiError(res.status, errBody, 'sending video');
        if (mapped.code === 'WHAPI_COMMUNITY_PARENT' || mapped.code === 'WHAPI_PERMISSION_DENIED') return { ok: false, code: mapped.code, message: mapped.message, status: res.status === 403 ? 403 : 400 };
        const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : res.status === 403 ? 'WHAPI_PERMISSION_DENIED' : res.status === 415 ? 'WHAPI_UNSUPPORTED_MEDIA' : 'WHAPI_PUBLISH_FAILED';
        const status = [400, 401, 402, 403, 415, 429].includes(res.status) ? res.status : 502;
        return { ok: false, code, message: mapped.message, status };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, message: 'Video sent to WhatsApp group.', data };
    }

    const payload = { to: cleanGroupId, ...mediaFields(mediaValue, 'image/jpeg'), caption: caption || undefined };
    const res = await sendAllowingAnnouncePropagation(() => whapiFetch('/messages/image', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl));
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const mapped = whapiError(res.status, errBody, 'sending image');
      if (mapped.code === 'WHAPI_COMMUNITY_PARENT' || mapped.code === 'WHAPI_PERMISSION_DENIED') return { ok: false, code: mapped.code, message: mapped.message, status: res.status === 403 ? 403 : 400 };
      const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : res.status === 403 ? 'WHAPI_PERMISSION_DENIED' : res.status === 415 ? 'WHAPI_UNSUPPORTED_MEDIA' : 'WHAPI_PUBLISH_FAILED';
      const status = [400, 401, 402, 403, 415, 429].includes(res.status) ? res.status : 502;
      return { ok: false, code, message: mapped.message, status };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, message: 'Image sent to WhatsApp group.', data };
  } catch (e) {
    console.error('[publishing-service] whapi network failure:', e instanceof Error ? e.message : e);
    return { ok: false, code: 'WHAPI_PUBLISH_FAILED', message: 'Network error sending to Whapi.', status: 502 };
  }
}
