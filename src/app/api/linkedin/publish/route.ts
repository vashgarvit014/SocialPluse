import { NextRequest, NextResponse } from 'next/server';
import { getLinkedInToken } from '../vault';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

// In-memory publish-attempt registry: one attempt ID = one LinkedIn request.
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

function err(code: string, message: string, status: number, attemptId?: string) {
  return NextResponse.json({ success: false, code, message, attemptId }, { status });
}

function linkedInErrorMessage(status: number, context: string): { code: string; message: string } {
  if (status === 401) {
    return {
      code: 'LINKEDIN_AUTH_EXPIRED',
      message: `LinkedIn authentication expired during ${context} (401). Please reconnect LinkedIn and try again.`,
    };
  }
  if (status === 403) {
    return {
      code: 'LINKEDIN_PERMISSION_DENIED',
      message: `LinkedIn denied permission during ${context} (403). The app may lack access or the post may be restricted.`,
    };
  }
  if (status === 429) {
    return {
      code: 'LINKEDIN_RATE_LIMIT',
      message: 'LinkedIn rate limit reached (429). Please wait a while and try again manually.',
    };
  }
  if (status >= 500) {
    return {
      code: 'LINKEDIN_PUBLISH_FAILED',
      message: `LinkedIn publishing error during ${context} (${status}). Please try again manually.`,
    };
  }
  return {
    code: 'LINKEDIN_PUBLISH_FAILED',
    message: `LinkedIn request failed during ${context} (${status}). Please try again manually.`,
  };
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('LINKEDIN_PUBLISH_FAILED', 'Invalid request body.', 400);
  }

  const {
    content,
    imageUrl,
    videoUrl,
    mediaUrl,
    mediaType,
    mediaUrls,
    mediaList,
    // accessToken in body is legacy compat only — the server vault is authoritative.
    accessToken: bodyToken,
    userId,
    attemptId,
  } = body as {
    content?: string;
    imageUrl?: string;
    videoUrl?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaUrls?: string[];
    mediaList?: Array<{ url?: string; type?: string }>;
    accessToken?: string;
    userId?: string;
    attemptId?: string;
  };

  if (!content || !userId) {
    return err('LINKEDIN_NOT_CONNECTED', 'LinkedIn is not connected. Reconnect through OAuth before publishing.', 401, typeof attemptId === 'string' ? attemptId : undefined);
  }

  const attempt = typeof attemptId === 'string' && attemptId ? attemptId : `att_${Date.now().toString(36)}`;
  if (typeof attemptId === 'string' && attemptId && isDuplicateAttempt(attemptId)) {
    console.warn(`[linkedin/publish] duplicate attempt ignored: ${attemptId} (user ${userId})`);
    return err('DUPLICATE_PUBLISH_REQUEST', 'Duplicate publish request ignored — this post is already being published.', 409, attemptId);
  }

  // Resolve token server-side. Never log or return it.
  const accessToken = getLinkedInToken(userId) || (typeof bodyToken === 'string' ? bodyToken : null);
  if (!accessToken) {
    console.warn(`[linkedin/publish] no stored token for user ${userId} (attempt ${attempt})`);
    return err('LINKEDIN_NOT_CONNECTED', 'LinkedIn is not connected. Reconnect through OAuth before publishing.', 401, attempt);
  }

  // Build ordered list of media dataURLs to upload (multi-image support).
  // LinkedIn allows 1 video OR up to 9 images per post, not mixed.
  const allUrls: string[] = Array.isArray(mediaUrls) && mediaUrls.length
    ? mediaUrls.filter((u): u is string => typeof u === 'string')
    : Array.isArray(mediaList) && mediaList.length
      ? mediaList.map(m => m.url).filter((u): u is string => typeof u === 'string')
      : [mediaUrl, videoUrl, imageUrl].find((u): u is string => typeof u === 'string' && u.length > 0)
        ? [[mediaUrl, videoUrl, imageUrl].find((u): u is string => typeof u === 'string' && u.length > 0) as string]
        : [];
  const mediaProvided = allUrls.length > 0;
  const hasVideo = (Array.isArray(mediaList) ? mediaList.some(m => m.type === 'video') : false)
    || allUrls.some(u => u.startsWith('data:video/'))
    || mediaType === 'video'
    || typeof videoUrl === 'string';
  const hasImage = allUrls.some(u => u.startsWith('data:image/')) || typeof imageUrl === 'string';
  if (hasVideo && hasImage) {
    console.warn(`[linkedin/publish] mixed image+video, publishing first video only (attempt ${attempt})`);
  }

  let urlsToUpload: string[] = [];
  if (hasVideo) {
    const videoUrlFound = allUrls.find(u => u.startsWith('data:video/')) || (mediaType === 'video' ? allUrls[0] : undefined);
    if (videoUrlFound) urlsToUpload = [videoUrlFound];
  } else {
    urlsToUpload = allUrls.filter(u => u.startsWith('data:image/')).slice(0, 9);
    if (urlsToUpload.length === 0 && allUrls.length) urlsToUpload = [allUrls[0]];
  }

  const mediaUrns: string[] = [];
  let shareMediaCategory: 'IMAGE' | 'VIDEO' | 'NONE' = 'NONE';

  // Single pass over distinct media items — no retries. Any auth/permission
  // failure aborts immediately with a structured error.
  for (const mediaDataUrl of urlsToUpload) {
    if (!mediaDataUrl?.startsWith('data:')) {
      console.warn(`[linkedin/publish] external URL media skipped (attempt ${attempt})`);
      continue;
    }
    const isVideoItem = mediaDataUrl.startsWith('data:video/');
    const base64Data = mediaDataUrl.split(',')[1];
    if (!base64Data) continue;
    const binaryData = Buffer.from(base64Data, 'base64');
    const recipe = isVideoItem ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';

    const registerResponse = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: [recipe],
          owner: `urn:li:person:${userId}`,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      }),
    }).catch((e: unknown) => {
      console.error(`[linkedin/publish] registerUpload network failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
      return null;
    });

    if (!registerResponse) {
      const mapped = linkedInErrorMessage(500, 'media upload');
      return err(mapped.code, mapped.message, 500, attempt);
    }
    if (registerResponse.status === 401 || registerResponse.status === 403) {
      const mapped = linkedInErrorMessage(registerResponse.status, 'media upload');
      console.error(`[linkedin/publish] registerUpload ${registerResponse.status} (attempt ${attempt}, user ${userId})`);
      return err(mapped.code, mapped.message, registerResponse.status, attempt);
    }
    if (!registerResponse.ok) {
      console.error(`[linkedin/publish] registerUpload failed ${registerResponse.status} (attempt ${attempt})`);
      continue;
    }

    let registerData: { value?: { uploadMechanism?: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: { uploadUrl?: string } }; asset?: string } };
    try {
      registerData = await registerResponse.json();
    } catch {
      console.error(`[linkedin/publish] registerUpload bad JSON (attempt ${attempt})`);
      continue;
    }
    const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
    const asset = registerData.value?.asset;
    if (!uploadUrl || !asset) {
      console.error(`[linkedin/publish] registerUpload missing uploadUrl/asset (attempt ${attempt})`);
      continue;
    }

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: binaryData,
    }).catch((e: unknown) => {
      console.error(`[linkedin/publish] media binary upload network failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
      return null;
    });

    if (!uploadRes) {
      const mapped = linkedInErrorMessage(500, 'media upload');
      return err(mapped.code, mapped.message, 500, attempt);
    }
    if (uploadRes.status === 401 || uploadRes.status === 403) {
      const mapped = linkedInErrorMessage(uploadRes.status, 'media upload');
      console.error(`[linkedin/publish] media upload ${uploadRes.status} (attempt ${attempt}, user ${userId})`);
      return err(mapped.code, mapped.message, uploadRes.status, attempt);
    }
    if (!uploadRes.ok) {
      console.error(`[linkedin/publish] media upload failed ${uploadRes.status} (attempt ${attempt})`);
      continue;
    }
    mediaUrns.push(asset);
    shareMediaCategory = isVideoItem ? 'VIDEO' : 'IMAGE';
    if (isVideoItem) break;
  }

  // Never silently fall back to text-only: media was selected but nothing uploaded.
  if (mediaProvided && mediaUrns.length === 0) {
    console.error(`[linkedin/publish] all media uploads failed, refusing text-only fallback (attempt ${attempt}, user ${userId})`);
    return err('LINKEDIN_MEDIA_UPLOAD_FAILED', 'LinkedIn media upload failed. The post was NOT published — no text-only fallback was used. Fix the media and try again manually.', 400, attempt);
  }

  const postPayload: Record<string, unknown> = {
    author: `urn:li:person:${userId}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content },
        shareMediaCategory: mediaUrns.length ? shareMediaCategory : 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  if (mediaUrns.length) {
    (postPayload.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] = {
      ...((postPayload.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] as Record<string, unknown>),
      media: mediaUrns.map(urn => ({ status: 'READY', media: urn })),
    };
  }

  const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postPayload),
  }).catch((e: unknown) => {
    console.error(`[linkedin/publish] ugcPosts network failure (attempt ${attempt}):`, e instanceof Error ? e.message : e);
    return null;
  });

  if (!postResponse) {
    const mapped = linkedInErrorMessage(500, 'post creation');
    return err(mapped.code, mapped.message, 500, attempt);
  }
  if (!postResponse.ok) {
    const mapped = linkedInErrorMessage(postResponse.status, 'post creation');
    console.error(`[linkedin/publish] ugcPosts ${postResponse.status} (attempt ${attempt}, user ${userId})`);
    return err(mapped.code, mapped.message, postResponse.status, attempt);
  }

  let postId: string | undefined;
  try {
    const postData = await postResponse.json();
    postId = postData.id;
  } catch {
    postId = undefined;
  }

  console.log(`[linkedin/publish] success (attempt ${attempt}, user ${userId}, media ${mediaUrns.length})`);
  logSystem({ level: 'SUCCESS', category: 'PUBLISHING', event: 'POST_PUBLISH_SUCCESS', userId: typeof userId === 'string' ? userId : undefined, platform: 'linkedin', resourceId: postId || undefined, message: 'LinkedIn post published', requestId: attempt });
  return NextResponse.json({
    success: true,
    postId,
    attemptId: attempt,
    message: 'Post published to LinkedIn!',
  });
}
