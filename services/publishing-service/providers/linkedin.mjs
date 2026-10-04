// Faithful port of src/app/api/linkedin/publish/route.ts's publishing logic
// (media upload + ugcPosts). Credential resolution and the in-memory
// duplicate guard are NOT duplicated here — those now live in
// credentials.mjs and idempotency.mjs (shared across providers), called by
// the route handler in src/server.mjs before this function runs.

function linkedInErrorMessage(status, context) {
  if (status === 401) return { code: 'LINKEDIN_AUTH_EXPIRED', message: `LinkedIn authentication expired during ${context} (401). Please reconnect LinkedIn and try again.` };
  if (status === 403) return { code: 'LINKEDIN_PERMISSION_DENIED', message: `LinkedIn denied permission during ${context} (403). The app may lack access or the post may be restricted.` };
  if (status === 429) return { code: 'LINKEDIN_RATE_LIMIT', message: 'LinkedIn rate limit reached (429). Please wait a while and try again manually.' };
  if (status >= 500) return { code: 'LINKEDIN_PUBLISH_FAILED', message: `LinkedIn publishing error during ${context} (${status}). Please try again manually.` };
  return { code: 'LINKEDIN_PUBLISH_FAILED', message: `LinkedIn request failed during ${context} (${status}). Please try again manually.` };
}

export async function publishToLinkedIn({ accessToken, providerUserId, content, imageUrl, videoUrl, mediaUrl, mediaType, mediaUrls, mediaList, attempt }) {
  const allUrls = Array.isArray(mediaUrls) && mediaUrls.length
    ? mediaUrls.filter((u) => typeof u === 'string')
    : Array.isArray(mediaList) && mediaList.length
      ? mediaList.map((m) => m.url).filter((u) => typeof u === 'string')
      : [mediaUrl, videoUrl, imageUrl].find((u) => typeof u === 'string' && u.length > 0)
        ? [[mediaUrl, videoUrl, imageUrl].find((u) => typeof u === 'string' && u.length > 0)]
        : [];
  const mediaProvided = allUrls.length > 0;
  const hasVideo = (Array.isArray(mediaList) ? mediaList.some((m) => m.type === 'video') : false) || allUrls.some((u) => u.startsWith('data:video/')) || mediaType === 'video' || typeof videoUrl === 'string';
  const hasImage = allUrls.some((u) => u.startsWith('data:image/')) || typeof imageUrl === 'string';
  if (hasVideo && hasImage) console.warn(`[publishing-service] linkedin mixed image+video, publishing first video only (attempt ${attempt})`);

  let urlsToUpload = [];
  if (hasVideo) {
    const videoUrlFound = allUrls.find((u) => u.startsWith('data:video/')) || (mediaType === 'video' ? allUrls[0] : undefined);
    if (videoUrlFound) urlsToUpload = [videoUrlFound];
  } else {
    urlsToUpload = allUrls.filter((u) => u.startsWith('data:image/')).slice(0, 9);
    if (urlsToUpload.length === 0 && allUrls.length) urlsToUpload = [allUrls[0]];
  }

  const mediaUrns = [];
  let shareMediaCategory = 'NONE';

  for (const mediaDataUrl of urlsToUpload) {
    if (!mediaDataUrl?.startsWith('data:')) continue;
    const isVideoItem = mediaDataUrl.startsWith('data:video/');
    const base64Data = mediaDataUrl.split(',')[1];
    if (!base64Data) continue;
    const binaryData = Buffer.from(base64Data, 'base64');
    const recipe = isVideoItem ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';

    const registerResponse = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ registerUploadRequest: { recipes: [recipe], owner: `urn:li:person:${providerUserId}`, serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }] } }),
    }).catch(() => null);

    if (!registerResponse) return { ok: false, ...linkedInErrorMessage(500, 'media upload'), status: 500 };
    if (registerResponse.status === 401 || registerResponse.status === 403) return { ok: false, ...linkedInErrorMessage(registerResponse.status, 'media upload'), status: registerResponse.status };
    if (!registerResponse.ok) continue;

    let registerData;
    try { registerData = await registerResponse.json(); } catch { continue; }
    const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
    const asset = registerData.value?.asset;
    if (!uploadUrl || !asset) continue;

    const uploadRes = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}` }, body: binaryData }).catch(() => null);
    if (!uploadRes) return { ok: false, ...linkedInErrorMessage(500, 'media upload'), status: 500 };
    if (uploadRes.status === 401 || uploadRes.status === 403) return { ok: false, ...linkedInErrorMessage(uploadRes.status, 'media upload'), status: uploadRes.status };
    if (!uploadRes.ok) continue;
    mediaUrns.push(asset);
    shareMediaCategory = isVideoItem ? 'VIDEO' : 'IMAGE';
    if (isVideoItem) break;
  }

  if (mediaProvided && mediaUrns.length === 0) {
    return { ok: false, code: 'LINKEDIN_MEDIA_UPLOAD_FAILED', message: 'LinkedIn media upload failed. The post was NOT published — no text-only fallback was used. Fix the media and try again manually.', status: 400 };
  }

  const postPayload = {
    author: `urn:li:person:${providerUserId}`,
    lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: content }, shareMediaCategory: mediaUrns.length ? shareMediaCategory : 'NONE' } },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
  if (mediaUrns.length) {
    postPayload.specificContent['com.linkedin.ugc.ShareContent'] = { ...postPayload.specificContent['com.linkedin.ugc.ShareContent'], media: mediaUrns.map((urn) => ({ status: 'READY', media: urn })) };
  }

  const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(postPayload),
  }).catch(() => null);

  if (!postResponse) return { ok: false, ...linkedInErrorMessage(500, 'post creation'), status: 500 };
  if (!postResponse.ok) return { ok: false, ...linkedInErrorMessage(postResponse.status, 'post creation'), status: postResponse.status };

  let postId;
  try { postId = (await postResponse.json()).id; } catch { postId = undefined; }
  return { ok: true, postId, message: 'Post published to LinkedIn!' };
}
