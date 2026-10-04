// Faithful port of src/app/api/facebook/publish/route.ts's publishing logic.
import { altPayload, mediaAlt } from './alt-capabilities.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

function graphError(status, body, context) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error?.message || '';
    if (parsed.error?.type === 'OAuthException' && /expired|invalid|session/i.test(detail)) {
      return { code: 'FACEBOOK_AUTH_EXPIRED', message: `Facebook Page session expired during ${context}. Please reconnect Facebook and try again.` };
    }
    if (parsed.error?.code === 200 || parsed.error?.code === 10) {
      return { code: 'FACEBOOK_PERMISSION_DENIED', message: `Facebook denied permission during ${context} (403). Check the Page grant and app scopes, then try again.` };
    }
  } catch { /* fall through */ }
  if (status === 401) return { code: 'FACEBOOK_AUTH_EXPIRED', message: `Facebook authentication expired during ${context} (401). Please reconnect Facebook and try again.` };
  if (status === 403) return { code: 'FACEBOOK_PERMISSION_DENIED', message: `Facebook denied permission during ${context} (403). Check the Page grant and app scopes, then try again.` };
  if (status === 429) return { code: 'FACEBOOK_RATE_LIMIT', message: 'Facebook rate limit reached (429). Please wait a while and try again manually.' };
  const suffix = detail ? ` ${detail.slice(0, 200)}` : '';
  return { code: 'FACEBOOK_PUBLISH_FAILED', message: `Facebook request failed during ${context} (${status}).${suffix} Please try again manually.` };
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const buffer = Buffer.from(match[3] || '', 'base64');
  if (!buffer.length) return null;
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  return { buffer, mime, ext: extMap[mime] || (mime.startsWith('video/') ? 'mp4' : 'jpg') };
}

export async function publishToFacebook({ targetPageId, pageToken, content, imageUrl, videoUrl, mediaUrl, mediaType, mediaUrls, mediaList, attempt }) {
  const allUrls = Array.isArray(mediaUrls) && mediaUrls.length
    ? mediaUrls.filter((u) => typeof u === 'string')
    : Array.isArray(mediaList) && mediaList.length
      ? mediaList.map((m) => m.url).filter((u) => typeof u === 'string')
      : [mediaUrl, videoUrl, imageUrl].find((u) => typeof u === 'string' && u.length > 0)
        ? [[mediaUrl, videoUrl, imageUrl].find((u) => typeof u === 'string' && u.length > 0)]
        : [];
  const hasVideo = (Array.isArray(mediaList) ? mediaList.some((m) => m.type === 'video') : false) || allUrls.some((u) => u.startsWith('data:video/')) || mediaType === 'video' || typeof videoUrl === 'string';
  const dataImages = allUrls.filter((u) => u.startsWith('data:image/')).slice(0, 9);
  const urlImages = allUrls.filter((u) => !u.startsWith('data:') && /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u)).slice(0, 9);

  try {
    const videoDataUrl = allUrls.find((u) => u.startsWith('data:video/')) || (hasVideo && allUrls[0]?.startsWith('data:') ? allUrls[0] : undefined);
    const videoRemoteUrl = !videoDataUrl && hasVideo ? allUrls.find((u) => !u.startsWith('data:')) : undefined;
    if (hasVideo && (videoDataUrl || videoRemoteUrl || typeof videoUrl === 'string')) {
      const form = new FormData();
      form.append('access_token', pageToken);
      form.append('description', content);
      if (videoDataUrl) {
        const parsed = parseDataUrl(videoDataUrl);
        if (!parsed) return { ok: false, code: 'FACEBOOK_MEDIA_UPLOAD_FAILED', message: 'Could not read the video file. The post was NOT published.', status: 400 };
        form.append('source', new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime }), `video.${parsed.ext}`);
      } else {
        form.append('file_url', videoRemoteUrl || videoUrl);
      }
      const res = await fetch(`${GRAPH}/${targetPageId}/videos`, { method: 'POST', body: form });
      if (!res.ok) { const { code, message } = graphError(res.status, await res.text(), 'video upload'); return { ok: false, code, message, status: res.status === 429 ? 429 : 502 }; }
      const data = await res.json();
      return { ok: true, postId: data.id };
    }

    if (dataImages.length + urlImages.length > 1) {
      const fbids = [];
      for (const { url: img, index } of allUrls.map((url, index) => ({ url, index })).filter(({ url }) => dataImages.includes(url) || urlImages.includes(url)).slice(0, 9)) {
        const alt = altPayload('facebook', 'image', mediaAlt(mediaList, img, index));
        let up;
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
          up = await fetch(`${GRAPH}/${targetPageId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...alt, url: img, published: false, access_token: pageToken }) });
        }
        if (!up.ok) { const { code, message } = graphError(up.status, await up.text(), 'photo upload'); return { ok: false, code: code === 'FACEBOOK_PUBLISH_FAILED' ? 'FACEBOOK_MEDIA_UPLOAD_FAILED' : code, message: `${message} The post was NOT published (no text-only fallback).`, status: up.status === 429 ? 429 : 502 }; }
        const upData = await up.json();
        if (upData.id) fbids.push({ media_fbid: upData.id });
      }
      if (fbids.length === 0) return { ok: false, code: 'FACEBOOK_MEDIA_UPLOAD_FAILED', message: 'Facebook photo uploads failed. The post was NOT published (no text-only fallback).', status: 502 };
      const postRes = await fetch(`${GRAPH}/${targetPageId}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: content, attached_media: fbids, access_token: pageToken }) });
      if (!postRes.ok) { const { code, message } = graphError(postRes.status, await postRes.text(), 'multi-photo post'); return { ok: false, code, message, status: postRes.status === 429 ? 429 : 502 }; }
      const postData = await postRes.json();
      return { ok: true, postId: postData.id };
    }

    const photo = dataImages[0] || urlImages[0] || (typeof imageUrl === 'string' ? imageUrl : undefined);
    if (photo) {
      const alt = altPayload('facebook', 'image', mediaAlt(mediaList, photo));
      let photoRes;
      if (photo.startsWith('data:')) {
        const parsed = parseDataUrl(photo);
        if (!parsed) return { ok: false, code: 'FACEBOOK_MEDIA_UPLOAD_FAILED', message: 'Could not read the image file. The post was NOT published (no text-only fallback).', status: 400 };
        const form = new FormData();
        form.append('access_token', pageToken);
        form.append('caption', content);
        for (const [key, value] of Object.entries(alt)) form.append(key, value);
        form.append('source', new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime }), `photo.${parsed.ext}`);
        photoRes = await fetch(`${GRAPH}/${targetPageId}/photos`, { method: 'POST', body: form });
      } else {
        photoRes = await fetch(`${GRAPH}/${targetPageId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...alt, url: photo, caption: content, access_token: pageToken }) });
      }
      if (!photoRes.ok) { const { code, message } = graphError(photoRes.status, await photoRes.text(), 'photo post'); return { ok: false, code: code === 'FACEBOOK_PUBLISH_FAILED' ? 'FACEBOOK_MEDIA_UPLOAD_FAILED' : code, message: `${message} The post was NOT published (no text-only fallback).`, status: photoRes.status === 429 ? 429 : 502 }; }
      const photoData = await photoRes.json();
      return { ok: true, postId: photoData.post_id || photoData.id };
    }

    const textRes = await fetch(`${GRAPH}/${targetPageId}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: content, access_token: pageToken }) });
    if (!textRes.ok) { const { code, message } = graphError(textRes.status, await textRes.text(), 'text post'); return { ok: false, code, message, status: textRes.status === 429 ? 429 : 502 }; }
    const textData = await textRes.json();
    return { ok: true, postId: textData.id };
  } catch (e) {
    console.error(`[publishing-service] facebook network failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
    return { ok: false, code: 'FACEBOOK_PUBLISH_FAILED', message: 'Network error publishing to Facebook — no retry was attempted.', status: 502 };
  }
}
