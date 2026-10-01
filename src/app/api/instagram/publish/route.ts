import { altPayload, mediaAlt } from '@/lib/alt-capabilities';
import { prepareInstagramMedia } from '@/lib/instagram-media';
import { publishInstagramTrialReel } from '@/lib/instagram-trial';
import { NextRequest, NextResponse } from 'next/server';
import { getInstagramAccount } from '../../facebook/vault';
import { requireApiActor } from '@/lib/internal-auth';
import { logSystem } from '@/lib/system-log';

// Instagram Business/Creator publishing goes through graph.facebook.com using
// the linked Page's access token (NOT graph.instagram.com - that's a
// different, newer API for accounts connected via direct Instagram login,
// which this app doesn't use). Two-step like Facebook video posts: create a
// media container, then publish it.
const GRAPH = 'https://graph.facebook.com/v21.0';

// Same in-memory duplicate-attempt guard as linkedin/publish and
// facebook/publish - one attempt ID = one Instagram request.
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

function graphError(status: number, body: string, context: string): { code: string; message: string } {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: number; type?: string } };
    detail = parsed.error?.message || '';
    // Narrow on purpose: the old /expired|invalid|session/ regex also matched
    // media errors like "Invalid video_url", mislabeling them as session
    // expiry. Only real token failures (Meta code 190 or token/session
    // wording) map here; everything else keeps Meta's own detail below.
    if (parsed.error?.code === 190 || (parsed.error?.type === 'OAuthException' && /(session|access.?token|oauth).*(expired|invalid)|invalid.*(access.?token|session|oauth)|password changed|not authorized/i.test(detail))) {
      return { code: 'INSTAGRAM_AUTH_EXPIRED', message: `Instagram session expired during ${context}. Please reconnect (via Facebook) and try again.` };
    }
    if (parsed.error?.code === 200 || parsed.error?.code === 10) {
      return { code: 'INSTAGRAM_PERMISSION_DENIED', message: `Instagram denied permission during ${context} (403). Check the linked account's scopes, then try again.` };
    }
  } catch { /* fall through to status mapping */ }
  if (status === 401) {
    return { code: 'INSTAGRAM_AUTH_EXPIRED', message: `Instagram authentication expired during ${context} (401). Please reconnect (via Facebook) and try again.` };
  }
  if (status === 403) {
    return { code: 'INSTAGRAM_PERMISSION_DENIED', message: `Instagram denied permission during ${context} (403). Check the linked account's scopes, then try again.` };
  }
  if (status === 429) {
    return { code: 'INSTAGRAM_RATE_LIMIT', message: 'Instagram rate limit reached (429). Please wait a while and try again manually.' };
  }
  const suffix = detail ? ` ${detail.slice(0, 200)}` : '';
  return { code: 'INSTAGRAM_PUBLISH_FAILED', message: `Instagram request failed during ${context} (${status}).${suffix} Please try again manually.` };
}

async function waitForContainer(id: string, token: string) {
  for (let check = 0; check < 12; check++) {
    const response = await fetch(`${GRAPH}/${id}?fields=status_code,status`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(graphError(response.status, await response.text(), 'media processing').message);
    const data = await response.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') throw new Error('Instagram could not process this media. Check its format and try again. The post was not published.');
    if (check < 11) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('Instagram is still processing the media. The post was not published; try again later.');
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
    return err('INSTAGRAM_PUBLISH_FAILED', 'Invalid request body.', 400);
  }

  // userId is the PROVIDER's Meta profile id and is accepted but unused for
// credential selection (see appUserId) - that was the cross-user token leak.
const { content, imageUrl, videoUrl, mediaUrl, mediaType, mediaUrls, mediaList, isCarousel, trialReel, collaborator, pageId, attemptId } = body as {
    content?: string;
    imageUrl?: string;
    videoUrl?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaUrls?: string[];
    mediaList?: Array<{ url?: string; type?: string; altText?: string }>;
    isCarousel?: boolean;
    trialReel?: boolean;
    collaborator?: string;
    pageId?: string;
    attemptId?: string;
  };

  // Whose credentials to publish with: the session user, unless the scheduler
  // is acting for the post's recorded owner via a signed internal assertion.
  const appUserId = actor.userId;

  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `att_${Date.now().toString(36)}`;
  if (typeof attemptId === 'string' && attemptId && isDuplicateAttempt(attemptId)) {
    console.warn(`[instagram/publish] duplicate attempt ignored: ${attemptId} (user ${appUserId})`);
    return err('DUPLICATE_PUBLISH_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attemptId);
  }

  const ig = await getInstagramAccount(appUserId, typeof pageId === 'string' ? pageId : undefined);
  if (!ig) {
    return err('INSTAGRAM_NOT_CONNECTED', 'No Instagram Business account is linked to the connected Facebook Page. Link one in Meta Business Suite, then reconnect.', 401, attempt);
  }

  const orderedUrls: string[] = Array.isArray(mediaUrls) && mediaUrls.length
    ? mediaUrls.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : Array.isArray(mediaList) && mediaList.length
      ? mediaList.map(m => m.url).filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
  let rawMedia = orderedUrls[0] || mediaUrl || videoUrl || imageUrl;
  const resolvedType = mediaType || (videoUrl ? 'video' : imageUrl ? 'image' : undefined);
  if (!rawMedia) {
    return err('INSTAGRAM_MEDIA_REQUIRED', 'Instagram requires an image or video — text-only posts are not supported by the API.', 400, attempt);
  }
  // This app currently supports image-only carousels.
  const wantsCarousel = isCarousel === true || orderedUrls.length > 1;
  const hasVideoInList = (Array.isArray(mediaList) ? mediaList.some(m => m.type === 'video') : false)
    || orderedUrls.some(u => u.startsWith('data:video/'))
    || resolvedType === 'video'
    || typeof videoUrl === 'string';
  if (wantsCarousel && hasVideoInList) {
    return err('INSTAGRAM_CAROUSEL_VIDEO', 'Instagram carousels accept images only — remove the video or switch this post back to a single post.', 400, attempt);
  }
  // Trial Reel seam: Instagram Reels only (single video, never carousel,
  // never photo). Trial posts must NEVER fall through to a normal Reel
  // publish — route them to the dedicated seam, which declines clearly until
  // the Meta Trial Reel integration is connected (see lib/instagram-trial).
  const isSingleVideoReel = !wantsCarousel && (hasVideoInList || resolvedType === 'video');
  if (trialReel === true && !isSingleVideoReel) {
    return err('INSTAGRAM_TRIAL_REEL_VIDEO_ONLY', 'Trial Reels require a single video — photos and carousels cannot be published as Trial Reels. Turn the Trial option off or switch this post to a single video.', 400, attempt);
  }
  if (trialReel === true && isSingleVideoReel) {
    // Trial posts must NEVER fall through to a normal Reel publish (a normal
    // Reel goes to followers). Return on both success and failure here.
    let stagedVideo: string;
    try {
      stagedVideo = await prepareInstagramMedia(rawMedia, true);
    } catch (e) {
      console.error(`[instagram/publish] trial media staging failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
      return err('INSTAGRAM_PUBLISH_FAILED', e instanceof Error ? e.message : 'Instagram trial media staging failed; no retry was attempted.', 502, attempt);
    }
    const collaboratorUsernames = typeof collaborator === 'string' && collaborator.trim()
      ? collaborator.split(/[,\s]+/).map((c) => c.trim().replace(/^@+/, '')).filter(Boolean).slice(0, 3)
      : undefined;
    const trial = await publishInstagramTrialReel({
      caption: content,
      videoUrl: stagedVideo,
      graduationStrategy: 'MANUAL',
      collaborators: collaboratorUsernames,
      igUserId: ig.igUserId,
      token: ig.token,
      attemptId: attempt,
    });
    if (!trial.ok) {
      logSystem({ level: 'ERROR', category: 'PUBLISHING', event: 'POST_PUBLISH_FAILED', userId: appUserId, platform: 'instagram', message: `${trial.code}: ${trial.message}`, requestId: attempt });
      return err(trial.code, trial.message, trial.status, attempt);
    }
    logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: appUserId, platform: 'instagram', resourceId: trial.postId, message: trial.mock ? 'Trial Reel simulated (mock mode)' : 'Trial Reel published to Instagram', requestId: attempt });
    return NextResponse.json({ success: true, postId: trial.postId, attemptId: attempt, mock: trial.mock === true, message: trial.message });
  }
  if (wantsCarousel) {
    let slides = orderedUrls.length > 1 ? orderedUrls : [rawMedia];
    if (slides.length > 10) return err('INSTAGRAM_CAROUSEL_MAX', 'Use at most 10 carousel images.', 400, attempt);
    if (slides.length < 2) {
      return err('INSTAGRAM_CAROUSEL_MIN', 'A carousel needs at least 2 images — add another slide or switch back to a single post.', 400, attempt);
    }
    try {
      slides = await Promise.all(slides.map(url => prepareInstagramMedia(url)));
      const childIds: string[] = [];
      for (let i = 0; i < slides.length; i++) {
        const childRes = await fetch(`${GRAPH}/${ig.igUserId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...altPayload('instagram', 'image', mediaAlt(mediaList, orderedUrls[i], i)), image_url: slides[i], is_carousel_item: true, access_token: ig.token }),
        });
        if (!childRes.ok) {
          const { code, message } = graphError(childRes.status, await childRes.text(), `carousel slide ${i + 1}/${slides.length}`);
          return err(code, `${message} The post was NOT published.`, childRes.status === 429 ? 429 : 502, attempt);
        }
        const childData = await childRes.json();
        if (!childData.id) {
          return err('INSTAGRAM_MEDIA_UPLOAD_FAILED', `Instagram did not return a container id for slide ${i + 1}. The post was NOT published.`, 502, attempt);
        }
        await waitForContainer(childData.id, ig.token);
        childIds.push(childData.id);
      }
      const parentRes = await fetch(`${GRAPH}/${ig.igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds, caption: content || '', access_token: ig.token }),
      });
      if (!parentRes.ok) {
        const { code, message } = graphError(parentRes.status, await parentRes.text(), 'carousel container creation');
        return err(code, `${message} The post was NOT published.`, parentRes.status === 429 ? 429 : 502, attempt);
      }
      const parentData = await parentRes.json();
      if (!parentData.id) {
        return err('INSTAGRAM_MEDIA_UPLOAD_FAILED', 'Instagram did not return a carousel container id. The post was NOT published.', 502, attempt);
      }
      await waitForContainer(parentData.id, ig.token);
      const publishRes = await fetch(`${GRAPH}/${ig.igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: parentData.id, access_token: ig.token }),
      });
      if (!publishRes.ok) {
        const { code, message } = graphError(publishRes.status, await publishRes.text(), 'carousel publish');
        return err(code, message, publishRes.status === 429 ? 429 : 502, attempt);
      }
      const publishData = await publishRes.json();
      logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: appUserId, platform: 'instagram', resourceId: publishData.id, message: `Carousel published to Instagram (${slides.length} slides)`, requestId: attempt });
      return NextResponse.json({ success: true, postId: publishData.id, attemptId: attempt, message: `Carousel published to Instagram (${slides.length} slides)!` });
    } catch (e) {
      console.error(`[instagram/publish] carousel network failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
      return err('INSTAGRAM_PUBLISH_FAILED', e instanceof Error ? e.message : 'Instagram carousel failed; no retry was attempted.', 502, attempt);
    }
  }
  try {
    rawMedia = await prepareInstagramMedia(rawMedia, resolvedType === 'video');
    const containerBody: Record<string, unknown> = {
      caption: content || '',
      access_token: ig.token,
    };
    // Collaborators is a list of up to 3 Instagram usernames (not IDs).
    const collaboratorUsernames = typeof collaborator === 'string' && collaborator.trim()
      ? collaborator.split(/[,\s]+/).map((c) => c.trim().replace(/^@+/, '')).filter(Boolean).slice(0, 3)
      : undefined;
    if (resolvedType === 'video') {
      containerBody.video_url = rawMedia;
      containerBody.media_type = 'REELS'; // Graph API video posts publish as Reels
      if (collaboratorUsernames) containerBody.collaborators = collaboratorUsernames;
    } else {
      containerBody.image_url = rawMedia;
      Object.assign(containerBody, altPayload('instagram', 'image', mediaAlt(mediaList, orderedUrls[0] || mediaUrl || imageUrl || '')));
      if (collaboratorUsernames) containerBody.collaborators = collaboratorUsernames;
    }

    const containerRes = await fetch(`${GRAPH}/${ig.igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerBody),
    });
    if (!containerRes.ok) {
      const { code, message } = graphError(containerRes.status, await containerRes.text(), 'media container creation');
      return err(code, `${message} The post was NOT published.`, containerRes.status === 429 ? 429 : 502, attempt);
    }
    const containerData = await containerRes.json();
    const containerId = containerData.id;
    if (!containerId) {
      return err('INSTAGRAM_MEDIA_UPLOAD_FAILED', 'Instagram did not return a media container id. The post was NOT published.', 502, attempt);
    }

    await waitForContainer(containerId, ig.token);
    const publishRes = await fetch(`${GRAPH}/${ig.igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId, access_token: ig.token }),
    });
    if (!publishRes.ok) {
      const { code, message } = graphError(publishRes.status, await publishRes.text(), 'publish');
      return err(code, message, publishRes.status === 429 ? 429 : 502, attempt);
    }
    const publishData = await publishRes.json();
    logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: appUserId, platform: 'instagram', resourceId: publishData.id, message: 'Post published to Instagram', requestId: attempt });
    return NextResponse.json({ success: true, postId: publishData.id, attemptId: attempt, message: 'Post published to Instagram!' });
  } catch (e) {
    console.error(`[instagram/publish] network failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
    logSystem({ level: 'ERROR', category: 'PUBLISHING', event: 'POST_PUBLISH_FAILED', userId: appUserId, platform: 'instagram', message: e instanceof Error ? e.message : 'Instagram publishing failed; no retry was attempted.', requestId: attempt });
    return err('INSTAGRAM_PUBLISH_FAILED', e instanceof Error ? e.message : 'Instagram publishing failed; no retry was attempted.', 502, attempt);
  }
}
