import { altPayload, mediaAlt } from '@/lib/alt-capabilities';
import { NextRequest, NextResponse } from 'next/server';
import { getFacebookPageToken } from '../vault';
import { requireApiActor } from '@/lib/internal-auth';
import { logSystem } from '@/lib/system-log';

const GRAPH = 'https://graph.facebook.com/v21.0';

// In-memory publish-attempt registry: one attempt ID = one Facebook request.
// Guards against double-clicks / rapid resubmits racing each other.
// NOTE: single-instance only; a restart clears the registry.
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

// Flat { success, code, message } shape - the frontend reads err.code /
// err.message directly (same contract as the LinkedIn publish route).
function err(code: string, message: string, status: number, attemptId?: string) {
  return NextResponse.json({ success: false, code, message, attemptId }, { status });
}

function graphError(status: number, body: string, context: string): { code: string; message: string } {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: number; type?: string } };
    detail = parsed.error?.message || '';
    // Expired/invalid Page token surfaces as 400 OAuthException - treat as expired.
    if (parsed.error?.type === 'OAuthException' && /expired|invalid|session/i.test(detail)) {
      return { code: 'FACEBOOK_AUTH_EXPIRED', message: `Facebook Page session expired during ${context}. Please reconnect Facebook and try again.` };
    }
    if (parsed.error?.code === 200 || parsed.error?.code === 10) {
      return { code: 'FACEBOOK_PERMISSION_DENIED', message: `Facebook denied permission during ${context} (403). Check the Page grant and app scopes, then try again.` };
    }
  } catch { /* fall through to status mapping */ }
  if (status === 401) {
    return { code: 'FACEBOOK_AUTH_EXPIRED', message: `Facebook authentication expired during ${context} (401). Please reconnect Facebook and try again.` };
  }
  if (status === 403) {
    return { code: 'FACEBOOK_PERMISSION_DENIED', message: `Facebook denied permission during ${context} (403). Check the Page grant and app scopes, then try again.` };
  }
  if (status === 429) {
    return { code: 'FACEBOOK_RATE_LIMIT', message: 'Facebook rate limit reached (429). Please wait a while and try again manually.' };
  }
  const suffix = detail ? ` ${detail.slice(0, 200)}` : '';
  return { code: 'FACEBOOK_PUBLISH_FAILED', message: `Facebook request failed during ${context} (${status}).${suffix} Please try again manually.` };
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string; ext: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const buffer = Buffer.from(match[3] || '', 'base64');
  if (!buffer.length) return null;
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  };
  return { buffer, mime, ext: extMap[mime] || (mime.startsWith('video/') ? 'mp4' : 'jpg') };
}

export async function POST(request: NextRequest) {
  // Accepts EITHER a signed-in browser or the publish worker's signed
  // assertion. A session alone would 401 the worker (it has no cookie) and
  // silently fail every scheduled post.
  const actor = await requireApiActor(request);
  if (actor instanceof NextResponse) return actor;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('FACEBOOK_PUBLISH_FAILED', 'Invalid request body.', 400);
  }

  const {
    content,
    imageUrl,
    videoUrl,
    mediaUrl,
    mediaType,
    mediaUrls,
    mediaList,
    // userId/pageId are the PROVIDER's Meta profile/Page ids. pageId may still
    // choose between THIS user's own Pages; userId is not consulted for
    // credential selection (see appUserId) - that was the cross-user leak.
    pageId,
    attemptId,
  } = body as {
    content?: string;
    imageUrl?: string;
    videoUrl?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaUrls?: string[];
    mediaList?: Array<{ url?: string; type?: string; altText?: string }>;
    pageId?: string;
    attemptId?: string;
  };

  if (!content) {
    return err('FACEBOOK_PUBLISH_FAILED', 'Post content is required.', 400, typeof attemptId === 'string' ? attemptId : undefined);
  }

  // Whose credentials to publish with: the session user, unless the scheduler
  // is acting for the post's recorded owner via a signed internal assertion.
  const appUserId = actor.userId;

  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `att_${Date.now().toString(36)}`;
  if (typeof attemptId === 'string' && attemptId && isDuplicateAttempt(attemptId)) {
    console.warn(`[facebook/publish] duplicate attempt ignored: ${attemptId} (user ${appUserId})`);
    return err('DUPLICATE_PUBLISH_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attemptId);
  }

  // Resolve the Page token server-side from the connection row owned by
  // appUserId. pageId only narrows within that user's own Pages. Never log or
  // return the token.
  const resolved = await getFacebookPageToken(appUserId, typeof pageId === 'string' ? pageId : undefined);
  if (!resolved) {
    console.warn(`[facebook/publish] no stored Page for user ${appUserId} (attempt ${attempt})`);
    return err('FACEBOOK_NOT_CONNECTED', 'Facebook Page is not connected. Reconnect through OAuth before publishing.', 401, attempt);
  }
  const { pageId: targetPageId, token: pageToken } = resolved;

  // Build ordered media list (multi-image support). Pages take 1 video OR
  // photo(s) per post, not mixed - video wins when both are present.
  const allUrls: string[] = Array.isArray(mediaUrls) && mediaUrls.length
    ? mediaUrls.filter((u): u is string => typeof u === 'string')
    : Array.isArray(mediaList) && mediaList.length
      ? mediaList.map(m => m.url).filter((u): u is string => typeof u === 'string')
      : [mediaUrl, videoUrl, imageUrl].find((u): u is string => typeof u === 'string' && u.length > 0)
        ? [[mediaUrl, videoUrl, imageUrl].find((u): u is string => typeof u === 'string' && u.length > 0) as string]
        : [];
  const hasVideo = (Array.isArray(mediaList) ? mediaList.some(m => m.type === 'video') : false)
    || allUrls.some(u => u.startsWith('data:video/'))
    || mediaType === 'video'
    || typeof videoUrl === 'string';
  const dataImages = allUrls.filter(u => u.startsWith('data:image/')).slice(0, 9);
  const urlImages = allUrls.filter(u => !u.startsWith('data:') && /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u)).slice(0, 9);

  try {
    // ---- Video post ----
    const videoDataUrl = allUrls.find(u => u.startsWith('data:video/')) || (hasVideo && allUrls[0]?.startsWith('data:') ? allUrls[0] : undefined);
    const videoRemoteUrl = !videoDataUrl && hasVideo ? allUrls.find(u => !u.startsWith('data:')) : undefined;
    if (hasVideo && (videoDataUrl || videoRemoteUrl || typeof videoUrl === 'string')) {
      const form = new FormData();
      form.append('access_token', pageToken);
      form.append('description', content);
      if (videoDataUrl) {
        const parsed = parseDataUrl(videoDataUrl);
        if (!parsed) return err('FACEBOOK_MEDIA_UPLOAD_FAILED', 'Could not read the video file. The post was NOT published.', 400, attempt);
        form.append('source', new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime }), `video.${parsed.ext}`);
      } else {
        form.append('file_url', (videoRemoteUrl || videoUrl) as string);
      }
      const res = await fetch(`${GRAPH}/${targetPageId}/videos`, { method: 'POST', body: form });
      if (!res.ok) {
        const { code, message } = graphError(res.status, await res.text(), 'video upload');
        return err(code, message, res.status === 429 ? 429 : 502, attempt);
      }
      const data = await res.json();
      logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: appUserId, platform: 'facebook', resourceId: data.id, message: 'Facebook post published', requestId: attempt });
      return NextResponse.json({ success: true, postId: data.id, attemptId: attempt });
    }

    // ---- Multi-photo post (unpublished uploads + attached_media) ----
    if (dataImages.length + urlImages.length > 1) {
      const fbids: Array<{ media_fbid: string }> = [];
      for (const { url: img, index } of allUrls.map((url, index) => ({ url, index })).filter(({ url }) => dataImages.includes(url) || urlImages.includes(url)).slice(0, 9)) {
        const alt = altPayload('facebook', 'image', mediaAlt(mediaList, img, index));
        let up: Response;
        if (img.startsWith('data:')) {
          const parsed = parseDataUrl(img);
          if (!parsed) continue;
          const form = new FormData();
          form.append('access_token', pageToken);
          form.append('published', 'false');
          for (const [key, value] of Object.entries(alt)) form.append(key, value);
          form.append('source', new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime }), `photo.${parsed.ext}`);
          up = await fetch(`${GRAPH}/${targetPageId}/photos`, { method: 'POST', body: form });
        } else {
          up = await fetch(`${GRAPH}/${targetPageId}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...alt, url: img, published: false, access_token: pageToken }),
          });
        }
        if (!up.ok) {
          const { code, message } = graphError(up.status, await up.text(), 'photo upload');
          return err(code === 'FACEBOOK_PUBLISH_FAILED' ? 'FACEBOOK_MEDIA_UPLOAD_FAILED' : code, `${message} The post was NOT published (no text-only fallback).`, up.status === 429 ? 429 : 502, attempt);
        }
        const upData = await up.json();
        if (upData.id) fbids.push({ media_fbid: upData.id });
      }
      if (fbids.length === 0) {
        return err('FACEBOOK_MEDIA_UPLOAD_FAILED', 'Facebook photo uploads failed. The post was NOT published (no text-only fallback).', 502, attempt);
      }
      const postRes = await fetch(`${GRAPH}/${targetPageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, attached_media: fbids, access_token: pageToken }),
      });
      if (!postRes.ok) {
        const { code, message } = graphError(postRes.status, await postRes.text(), 'multi-photo post');
        return err(code, message, postRes.status === 429 ? 429 : 502, attempt);
      }
      const postData = await postRes.json();
      logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: appUserId, platform: 'facebook', resourceId: postData.id, message: 'Facebook post published', requestId: attempt });
      return NextResponse.json({ success: true, postId: postData.id, attemptId: attempt });
    }

    // ---- Single photo post ----
    const photo = dataImages[0] || urlImages[0] || (typeof imageUrl === 'string' ? imageUrl : undefined);
    if (photo) {
      const alt = altPayload('facebook', 'image', mediaAlt(mediaList, photo));
      let photoRes: Response;
      if (photo.startsWith('data:')) {
        const parsed = parseDataUrl(photo);
        if (!parsed) return err('FACEBOOK_MEDIA_UPLOAD_FAILED', 'Could not read the image file. The post was NOT published (no text-only fallback).', 400, attempt);
        const form = new FormData();
        form.append('access_token', pageToken);
        form.append('caption', content);
        for (const [key, value] of Object.entries(alt)) form.append(key, value);
        form.append('source', new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime }), `photo.${parsed.ext}`);
        photoRes = await fetch(`${GRAPH}/${targetPageId}/photos`, { method: 'POST', body: form });
      } else {
        photoRes = await fetch(`${GRAPH}/${targetPageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...alt, url: photo, caption: content, access_token: pageToken }),
        });
      }
      if (!photoRes.ok) {
        const { code, message } = graphError(photoRes.status, await photoRes.text(), 'photo post');
        const finalCode = code === 'FACEBOOK_PUBLISH_FAILED' ? 'FACEBOOK_MEDIA_UPLOAD_FAILED' : code;
        return err(finalCode, `${message} The post was NOT published (no text-only fallback).`, photoRes.status === 429 ? 429 : 502, attempt);
      }
      const photoData = await photoRes.json();
      logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: appUserId, platform: 'facebook', resourceId: photoData.post_id || photoData.id, message: 'Facebook post published', requestId: attempt });
      return NextResponse.json({ success: true, postId: photoData.post_id || photoData.id, attemptId: attempt });
    }

    // ---- Text-only post ----
    const textRes = await fetch(`${GRAPH}/${targetPageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: pageToken }),
    });
    if (!textRes.ok) {
      const { code, message } = graphError(textRes.status, await textRes.text(), 'text post');
      return err(code, message, textRes.status === 429 ? 429 : 502, attempt);
    }
    const textData = await textRes.json();
    logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: appUserId, platform: 'facebook', resourceId: textData.id, message: 'Facebook post published', requestId: attempt });
    return NextResponse.json({ success: true, postId: textData.id, attemptId: attempt });
  } catch (e) {
    console.error(`[facebook/publish] network failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
    logSystem({ level: 'ERROR', category: 'PUBLISHING', event: 'POST_PUBLISH_FAILED', userId: appUserId, platform: 'facebook', message: e instanceof Error ? e.message : 'Facebook publishing failed; no retry was attempted.', requestId: attempt });
    return err('FACEBOOK_PUBLISH_FAILED', 'Network error publishing to Facebook — no retry was attempted.', 502, attempt);
  }
}
