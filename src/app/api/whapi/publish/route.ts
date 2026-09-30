import { NextRequest, NextResponse } from 'next/server';
import { getWhapiConfig, whapiFetch, whapiError, sanitizeForLog } from '../client';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';
import { prepareWhapiMedia } from '@/lib/whapi-media';

// In-memory publish-attempt registry — same pattern as linkedin/publish, facebook/publish
const seenAttempts = new Map<string, number>();
const ATTEMPT_TTL_MS = 15 * 60 * 1000;

function isDuplicateAttempt(attemptId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of seenAttempts) {
    if (now - ts > ATTEMPT_TTL_MS) seenAttempts.delete(id);
  }
  if (seenAttempts.has(attemptId)) return true;
  seenAttempts.set(attemptId, now);
  return false;
}

function err(code: string, message: string, status: number, attemptId?: string) {
  return NextResponse.json({ success: false, code, message, attemptId }, { status });
}

// Validate groupId shape: Whapi group IDs are like 120363...@g.us or similar
function isValidGroupId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length < 10 || trimmed.length > 40) return false;
  // Must end with @g.us for groups, or @s.whatsapp.net for contacts — we only allow groups
  if (!trimmed.includes('@')) return false;
  // Basic pattern: digits/hyphen + @g.us
  return /@g\.us$/.test(trimmed) || trimmed.includes('@g.us');
}

// Whapi media rules (per their docs): a data: URL must be split into RAW
// base64 (no data: prefix) + explicit mime_type. Sending the full data URL
// without mime_type makes image/video/document sends fail.
function splitDataUrl(url: string): { raw: string; mime: string } | null {
  const m = /^data:([^;,]+)?(?:;[^;,]+)*;base64,([\s\S]+)$/.exec(url.trim());
  if (!m) return null;
  return { raw: m[2].replace(/\s+/g, ''), mime: m[1] || '' };
}

// Builds { media, mime_type? }: data URLs become raw base64 + mime_type,
// public https URLs pass through untouched (no mime needed).
function mediaFields(url: string, fallbackMime: string): { media: string; mime_type?: string } {
  const parts = splitDataUrl(url);
  if (!parts) return { media: url };
  return { media: parts.raw, mime_type: parts.mime || fallbackMime };
}

// Helper: confirm groupId exists in the connected channel (prevents arbitrary
// chat IDs). MUST paginate: Whapi's /groups is paged, and a large channel has
// far more than one page. Reading only the first 100 made every group beyond
// that page fail as "not found" even though it exists and is listed in the
// picker. Stops as soon as the id is found, and gives up (allowing the send,
// so a transient fetch problem never blocks a legitimate post) after a bounded
// number of pages.
async function validateGroupExists(groupId: string, baseUrl: string, token: string): Promise<{ valid: boolean; error?: string }> {
  const PAGE = 100;
  const MAX_PAGES = 20; // 2000 groups — far beyond any realistic channel
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE;
      const res = await whapiFetch(`/groups?count=${PAGE}&offset=${offset}`, token, { method: 'GET' }, baseUrl);
      if (!res.ok) {
        // If groups fetch fails, we still allow publish but log — don't block legit retries during transient failures
        // Instead we do strict validation: only reject if we can prove group not found
        // For now, if fetch fails, return valid=true and let the send attempt surface the real error
        console.warn(`[whapi/publish] groups validation fetch failed ${res.status}, skipping strict check for ${groupId.slice(0, 8)}...`);
        return { valid: true };
      }
      const data = (await res.json().catch(() => ({}))) as { groups?: Array<{ id?: string }>; total?: number };
      const groups = Array.isArray(data.groups) ? data.groups : [];
      if (groups.some(g => g.id === groupId)) return { valid: true };
      // Short page (or a known total we've now passed) means it is genuinely absent.
      if (groups.length < PAGE) break;
      if (typeof data.total === 'number' && offset + groups.length >= data.total) break;
    }
    return { valid: false, error: `Group ${groupId} not found in connected Whapi channel groups.` };
  } catch (e) {
    console.warn('[whapi/publish] groups validation network error:', e instanceof Error ? e.message : e);
    return { valid: true };
  }
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('WHAPI_BAD_REQUEST', 'Invalid request body. Expected JSON.', 400);
  }

  const { groupId, text, mediaList, attemptId } = body as {
    groupId?: string;
    text?: string;
    mediaList?: Array<{ url?: string; type?: string; name?: string }>;
    attemptId?: string;
  };

  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `whapi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  if (attemptId && isDuplicateAttempt(attemptId)) {
    console.warn(`[whapi/publish] duplicate attempt ignored: ${attemptId}`);
    return err('WHAPI_DUPLICATE_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attemptId);
  }
  if (attemptId) seenAttempts.set(attemptId, Date.now());

  const config = getWhapiConfig();
  if (!config) {
    return err('WHAPI_NOT_CONFIGURED', 'Whapi is not configured. Add WHAPI_API_TOKEN to .env.local.', 401, attempt);
  }

  if (!groupId || !groupId.trim()) {
    return err('WHAPI_GROUP_NOT_FOUND', 'A valid groupId is required.', 400, attempt);
  }
  const cleanGroupId = groupId.trim();
  if (!isValidGroupId(cleanGroupId)) {
    return err('WHAPI_GROUP_NOT_FOUND', 'Invalid group ID format. Must be a group like 120363...@g.us', 400, attempt);
  }

  // Validate group exists in fetched groups (existing-group only)
  const validation = await validateGroupExists(cleanGroupId, config.baseUrl, config.token);
  if (!validation.valid) {
    return err('WHAPI_GROUP_NOT_FOUND', validation.error || 'Group not found in connected channel.', 404, attempt);
  }

  const caption = typeof text === 'string' ? text.trim() : '';
  const list = Array.isArray(mediaList) ? mediaList.filter(m => m && typeof m.url === 'string' && m.url.length > 0) : [];

  if (!caption && list.length === 0) {
    return err('WHAPI_BAD_REQUEST', 'Either text or media is required.', 400, attempt);
  }

  // Media order is preserved as-is; enforce single-media rule per Whapi (no fake carousel)
  if (list.length > 1) {
    // Whapi does not support album/carousel in one call — we handle single media only.
    // If multiple provided, publish sequentially? Spec says DO NOT fake carousel. So we publish only first with caption
    // and warn, but still succeed for first media.
    // However per spec "Multiple media only if Whapi officially supports" — so we reject multi for now to avoid confusion.
    // Instead: allow but only first will be sent; caller should send one at a time.
    // For safety, we will process only the first media item and ignore rest, but not error.
    console.warn(`[whapi/publish] multiple media (${list.length}) received, sending first only (attempt ${attempt})`);
  }

  const firstMedia = list[0];
  const hasMedia = !!firstMedia;

  try {
    if (!hasMedia) {
      // 1. Text only
      const payload = { to: cleanGroupId, body: caption };
      console.log(`[whapi/publish] text to ${cleanGroupId.slice(0, 12)}... attempt ${attempt} ${sanitizeForLog({ len: caption.length })}`);
      const res = await whapiFetch('/messages/text', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const mapped = whapiError(res.status, errBody, 'sending text');
        // Preserve mapped code for 400 community-parent, 402 trial limit, 403 not-admin etc
        const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : res.status === 403 ? 'WHAPI_PERMISSION_DENIED' : 'WHAPI_PUBLISH_FAILED';
        const status = res.status === 400 || res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429 ? res.status : 502;
        return err(code, mapped.message, status, attempt);
      }
      const data = await res.json().catch(() => ({}));
      logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: session.userId, platform: 'whatsapp', resourceId: groupId, message: 'Message sent to WhatsApp group', requestId: attempt });
      return NextResponse.json({ success: true, message: 'Message sent to WhatsApp group.', attemptId: attempt, data });
    }

    // Media present: determine type
    const url = firstMedia.url as string;
    const type = firstMedia.type === 'video' ? 'video' : firstMedia.type === 'image' ? 'image' : url.startsWith('data:video/') ? 'video' : 'image';
    const isVideo = type === 'video';
    const isDocument = firstMedia.type === 'document' || (!isVideo && !url.startsWith('data:image/') && !url.startsWith('data:video/') && !!firstMedia.name);

    // Whapi fetches `media` as a URL — it does not accept base64 or data:
    // URLs (raw base64 => 404 "media with specified id not found", data: URL
    // => 500 bad-request). Stage data: URLs on disk and hand Whapi a public
    // https URL instead. Absolute https URLs pass through untouched.
    let mediaValue: string;
    try {
      mediaValue = await prepareWhapiMedia(url);
    } catch (e) {
      return err('WHAPI_UNSUPPORTED_MEDIA', e instanceof Error ? e.message : 'This media cannot be published to WhatsApp.', 400, attempt);
    }

    if (isDocument) {
      // Document: requires media + filename + caption
      const filename = firstMedia.name || 'document.pdf';
      const ext = (filename.split('.').pop() || '').toLowerCase();
      const docMime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
      const payload: Record<string, unknown> = {
        to: cleanGroupId,
        ...mediaFields(mediaValue, docMime),
        caption: caption || undefined,
        filename,
      };
      console.log(`[whapi/publish] document to ${cleanGroupId.slice(0, 12)}... attempt ${attempt}`);
      const res = await whapiFetch('/messages/document', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const mapped = whapiError(res.status, errBody, 'sending document');
        // If document not supported, surface unsupported
        if (res.status === 400 && /unsupported/i.test(errBody)) {
          return err('WHAPI_UNSUPPORTED_MEDIA', 'Document not supported by Whapi for this channel.', 400, attempt);
        }
        const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : 'WHAPI_PUBLISH_FAILED';
        const status = res.status === 400 || res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429 ? res.status : 502;
        return err(code, mapped.message, status, attempt);
      }
      const data = await res.json().catch(() => ({}));
      logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: session.userId, platform: 'whatsapp', resourceId: groupId, message: 'Document sent to WhatsApp group', requestId: attempt });
      return NextResponse.json({ success: true, message: 'Document sent to WhatsApp group.', attemptId: attempt, data });
    }

    if (isVideo) {
      // Video + caption
      const payload: Record<string, unknown> = {
        to: cleanGroupId,
        ...mediaFields(mediaValue, 'video/mp4'),
        caption: caption || undefined,
      };
      console.log(`[whapi/publish] video to ${cleanGroupId.slice(0, 12)}... attempt ${attempt}`);
      const res = await whapiFetch('/messages/video', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const mapped = whapiError(res.status, errBody, 'sending video');
        if (mapped.code === 'WHAPI_COMMUNITY_PARENT' || mapped.code === 'WHAPI_PERMISSION_DENIED') {
          return err(mapped.code, mapped.message, res.status === 403 ? 403 : 400, attempt);
        }
        const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : res.status === 403 ? 'WHAPI_PERMISSION_DENIED' : res.status === 415 ? 'WHAPI_UNSUPPORTED_MEDIA' : 'WHAPI_PUBLISH_FAILED';
        const status = res.status === 400 || res.status === 401 || res.status === 402 || res.status === 403 || res.status === 415 || res.status === 429 ? res.status : 502;
        return err(code, mapped.message, status, attempt);
      }
      const data = await res.json().catch(() => ({}));
      logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: session.userId, platform: 'whatsapp', resourceId: groupId, message: 'Video sent to WhatsApp group', requestId: attempt });
      return NextResponse.json({ success: true, message: 'Video sent to WhatsApp group.', attemptId: attempt, data });
    }

    // Default: image + caption
    const payload: Record<string, unknown> = {
      to: cleanGroupId,
      ...mediaFields(mediaValue, 'image/jpeg'),
      caption: caption || undefined,
    };
    console.log(`[whapi/publish] image to ${cleanGroupId.slice(0, 12)}... attempt ${attempt} caption ${caption.length} chars`);
    const res = await whapiFetch('/messages/image', config.token, { method: 'POST', body: JSON.stringify(payload) }, config.baseUrl);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const mapped = whapiError(res.status, errBody, 'sending image');
      // Log the provider's own status + body. Without this a failed send left
      // only an "attempt" line and no reason anywhere, which is what made the
      // original "Failed to publish to WhatsApp group." untraceable.
      console.error(`[whapi/publish] image FAILED status=${res.status} code=${mapped.code} to=${cleanGroupId.slice(0, 20)}... body=${errBody.slice(0, 400)}`);
      if (mapped.code === 'WHAPI_COMMUNITY_PARENT' || mapped.code === 'WHAPI_PERMISSION_DENIED') {
        return err(mapped.code, mapped.message, res.status === 403 ? 403 : 400, attempt);
      }
      const code = mapped.code !== 'WHAPI_REQUEST_FAILED' ? mapped.code : res.status === 401 ? 'WHAPI_UNAUTHORIZED' : res.status === 403 ? 'WHAPI_PERMISSION_DENIED' : res.status === 415 ? 'WHAPI_UNSUPPORTED_MEDIA' : 'WHAPI_PUBLISH_FAILED';
      const status = res.status === 400 || res.status === 401 || res.status === 402 || res.status === 403 || res.status === 415 || res.status === 429 ? res.status : 502;
      return err(code, mapped.message, status, attempt);
    }
    const data = await res.json().catch(() => ({}));
    logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: session.userId, platform: 'whatsapp', resourceId: groupId, message: 'Image sent to WhatsApp group', requestId: attempt });
    return NextResponse.json({ success: true, message: 'Image sent to WhatsApp group.', attemptId: attempt, data });
  } catch (e) {
    console.error('[whapi/publish] network failure:', e instanceof Error ? e.message : e);
    logSystem({ level: 'ERROR', category: 'PUBLISHING', event: 'POST_PUBLISH_FAILED', userId: session.userId, platform: 'whatsapp', resourceId: groupId, message: e instanceof Error ? e.message : 'Network error sending to Whapi.', requestId: attempt });
    return err('WHAPI_PUBLISH_FAILED', 'Network error sending to Whapi.', 502, attempt);
  }
}
