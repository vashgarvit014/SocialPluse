// Faithful port of src/app/api/instagram/publish/route.ts's publishing logic.
import { altPayload, mediaAlt } from './alt-capabilities.mjs';
import { publishInstagramTrialReel } from './instagram-trial.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

// Collaborators requested on this call: Array<{ username: string; type: 'professional' | 'private' }>.
// Normalizes once, strips '@'/whitespace, caps at 3 (matches Instagram's own
// limit). `professional` is the subset actually sent to Graph as the
// `collaborators` container param — private accounts aren't eligible for
// API-based invites, so they're structurally excluded here and the caller
// must route them through the manual in-app invite flow instead.
function splitCollaborators(list) {
  if (!Array.isArray(list) || !list.length) return { professional: undefined, all: [] };
  const all = list
    .map((c) => ({ username: String(c?.username || '').trim().replace(/^@+/, ''), type: c?.type === 'private' ? 'private' : 'professional' }))
    .filter((c) => c.username)
    .slice(0, 3);
  const professional = all.filter((c) => c.type === 'professional').map((c) => c.username);
  return { professional: professional.length ? professional : undefined, all };
}

// Builds the collaboratorResults array attached to every publishToInstagram
// return (success and failure) so callers (server.mjs, scheduler worker)
// never need to re-derive per-collaborator status from a Graph error.
//   ok=true          -> professional: 'Submitted', private: 'Ready'
//   ok=false, collab  -> professional: 'Failed' (rejected specifically because
//     specific=true     of a collaborator), private: unchanged (never sent)
//   ok=false, other   -> professional: 'Unknown' (failure wasn't necessarily
//     reason              about the collaborator), private: unchanged
// Private entries are never touched on failure, and never 'Failed'/'Unknown'
// on success either — their status only ever updates once the human-driven
// manual invite flow advances it.
function collaboratorResults(all, ok, collabSpecific) {
  return all
    .map((c) => {
      if (ok) return { username: c.username, type: c.type, status: c.type === 'private' ? 'Ready' : 'Submitted' };
      if (c.type === 'private') return null;
      return { username: c.username, type: c.type, status: collabSpecific ? 'Failed' : 'Unknown' };
    })
    .filter(Boolean);
}

function graphError(status, body, context, attemptedCollaborators) {
  let detail = '';
  let parsed;
  try {
    parsed = JSON.parse(body);
    detail = parsed.error?.message || parsed.error?.error_user_msg || '';
  } catch { /* fall through */ }
  const hasCollaborators = Array.isArray(attemptedCollaborators) && attemptedCollaborators.length > 0;
  // Checked before the generic auth/permission buckets below: Meta surfaces
  // ineligible/rejected collaborators (personal accounts, accounts that don't
  // allow collab invites, blocked users) through ordinary error codes, so the
  // only reliable signal is the error message itself mentioning the feature.
  if (hasCollaborators && detail && /collaborat|invite/i.test(detail)) {
    return { code: 'INSTAGRAM_COLLAB_REJECTED', message: `Instagram rejected one or more collaborators during ${context} (${status}). They may not be eligible to collaborate (personal accounts, accounts that don't allow collab invites, or blocked users can't be added this way). The post was NOT published; remove the ineligible collaborator and try again.` };
  }
  if (parsed) {
    if (parsed.error?.code === 190 || (parsed.error?.type === 'OAuthException' && /(session|access.?token|oauth).*(expired|invalid)|invalid.*(access.?token|session|oauth)|password changed|not authorized/i.test(detail))) {
      return { code: 'INSTAGRAM_AUTH_EXPIRED', message: `Instagram session expired during ${context}. Please reconnect (via Facebook) and try again.` };
    }
    if (parsed.error?.code === 200 || parsed.error?.code === 10) {
      return { code: 'INSTAGRAM_PERMISSION_DENIED', message: `Instagram denied permission during ${context} (403). Check the linked account's scopes, then try again.` };
    }
  }
  if (status === 401) return { code: 'INSTAGRAM_AUTH_EXPIRED', message: `Instagram authentication expired during ${context} (401). Please reconnect (via Facebook) and try again.` };
  if (status === 403) return { code: 'INSTAGRAM_PERMISSION_DENIED', message: `Instagram denied permission during ${context} (403). Check the linked account's scopes, then try again.` };
  if (status === 429) return { code: 'INSTAGRAM_RATE_LIMIT', message: 'Instagram rate limit reached (429). Please wait a while and try again manually.' };
  const suffix = detail ? ` ${detail.slice(0, 200)}` : '';
  return { code: 'INSTAGRAM_PUBLISH_FAILED', message: `Instagram request failed during ${context} (${status}).${suffix} Please try again manually.` };
}

// Best-effort permalink lookup so the "Open Instagram" manual-invite button
// can deep-link to the exact post instead of a generic entry point. Only
// called when a private collaborator is actually waiting on it — never
// allowed to fail the publish itself; any error here is swallowed and the
// caller falls back to the generic instagram.com link.
async function fetchPermalink(mediaId, token) {
  try {
    const res = await fetch(`${GRAPH}/${mediaId}?fields=permalink`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data.permalink === 'string' ? data.permalink : undefined;
  } catch {
    return undefined;
  }
}

async function waitForContainer(id, token) {
  for (let check = 0; check < 12; check++) {
    const response = await fetch(`${GRAPH}/${id}?fields=status_code,status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(graphError(response.status, await response.text(), 'media processing').message);
    const data = await response.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') throw new Error('Instagram could not process this media. Check its format and try again. The post was not published.');
    if (check < 11) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Instagram is still processing the media. The post was not published; try again later.');
}

export async function publishToInstagram({ ig, content, imageUrl, videoUrl, mediaUrl, mediaType, mediaUrls, mediaList, isCarousel, trialReel, collaborators, attempt, prepareInstagramMedia }) {
  const { professional: collaboratorUsernames, all: collaboratorList } = splitCollaborators(collaborators);

  // Local dev/test short-circuit so collaborator flows are clickable without
  // real Meta credentials — mirrors MOCK_TRIAL_REELS's pattern. Values:
  // 'true' (success), 'reject' (collab-specific failure), 'rate_limit', 'auth_expired'.
  const mockMode = process.env.MOCK_INSTAGRAM_COLLAB;
  if (mockMode && collaboratorList.length) {
    if (mockMode === 'reject') return { ok: false, code: 'INSTAGRAM_COLLAB_REJECTED', message: "Instagram rejected one or more collaborators during media container creation (400). They may not be eligible to collaborate (personal accounts, accounts that don't allow collab invites, or blocked users can't be added this way). The post was NOT published; remove the ineligible collaborator and try again. (mock)", status: 400, collaboratorResults: collaboratorResults(collaboratorList, false, true) };
    if (mockMode === 'rate_limit') return { ok: false, code: 'INSTAGRAM_RATE_LIMIT', message: 'Instagram rate limit reached (429). Please wait a while and try again manually. (mock)', status: 429, collaboratorResults: collaboratorResults(collaboratorList, false, false) };
    if (mockMode === 'auth_expired') return { ok: false, code: 'INSTAGRAM_AUTH_EXPIRED', message: 'Instagram session expired during media container creation. Please reconnect (via Facebook) and try again. (mock)', status: 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) };
    return { ok: true, postId: `mock_${attempt}`, mock: true, message: 'Post published to Instagram! (mock)', collaboratorResults: collaboratorResults(collaboratorList, true, false), postUrl: 'https://www.instagram.com/p/mock/' };
  }

  // Only fetched when a private collaborator is actually waiting on the
  // manual-invite link — skips the extra Graph round-trip otherwise.
  const needsPermalink = collaboratorList.some((c) => c.type === 'private');

  const orderedUrls = Array.isArray(mediaUrls) && mediaUrls.length
    ? mediaUrls.filter((u) => typeof u === 'string' && u.length > 0)
    : Array.isArray(mediaList) && mediaList.length
      ? mediaList.map((m) => m.url).filter((u) => typeof u === 'string' && u.length > 0)
      : [];
  let rawMedia = orderedUrls[0] || mediaUrl || videoUrl || imageUrl;
  const resolvedType = mediaType || (videoUrl ? 'video' : imageUrl ? 'image' : undefined);
  if (!rawMedia) return { ok: false, code: 'INSTAGRAM_MEDIA_REQUIRED', message: 'Instagram requires an image or video — text-only posts are not supported by the API.', status: 400 };

  // Multiple Images with exactly ONE media item publishes through the normal
  // single-media path below — Instagram's CAROUSEL container API requires two
  // or more children, so a 1-image carousel must not enter this branch.
  const wantsCarousel = orderedUrls.length > 1;
  const hasVideoInList = (Array.isArray(mediaList) ? mediaList.some((m) => m.type === 'video') : false) || orderedUrls.some((u) => u.startsWith('data:video/')) || resolvedType === 'video' || typeof videoUrl === 'string';
  if (wantsCarousel && hasVideoInList) return { ok: false, code: 'INSTAGRAM_CAROUSEL_VIDEO', message: 'Instagram carousels accept images only — remove the video or switch this post back to a single post.', status: 400 };

  const isSingleVideoReel = !wantsCarousel && (hasVideoInList || resolvedType === 'video');
  if (trialReel === true && !isSingleVideoReel) return { ok: false, code: 'INSTAGRAM_TRIAL_REEL_VIDEO_ONLY', message: 'Trial Reels require a single video — photos and carousels cannot be published as Trial Reels. Turn the Trial option off or switch this post to a single video.', status: 400 };
  if (trialReel === true && isSingleVideoReel) {
    let stagedVideo;
    try {
      stagedVideo = await prepareInstagramMedia(rawMedia, true);
    } catch (e) {
      return { ok: false, code: 'INSTAGRAM_PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Instagram trial media staging failed; no retry was attempted.', status: 502 };
    }
    const trial = await publishInstagramTrialReel({ caption: content, videoUrl: stagedVideo, graduationStrategy: 'MANUAL', collaborators: collaboratorUsernames, igUserId: ig.igUserId, token: ig.token, attemptId: attempt });
    if (!trial.ok) return { ok: false, code: trial.code, message: trial.message, status: trial.status, collaboratorResults: collaboratorResults(collaboratorList, false, trial.code === 'INSTAGRAM_COLLAB_REJECTED') };
    const trialPostUrl = needsPermalink && trial.postId && !trial.mock ? await fetchPermalink(trial.postId, ig.token) : undefined;
    return { ok: true, postId: trial.postId, mock: trial.mock === true, message: trial.message, collaboratorResults: collaboratorResults(collaboratorList, true, false), postUrl: trialPostUrl };
  }

  if (wantsCarousel) {
    // wantsCarousel means 2+ ordered URLs — the app-level cap for Multiple
    // Images is 9 images (matches LinkedIn/Facebook and the UI gallery cap).
    let slides = orderedUrls;
    if (slides.length > 9) return { ok: false, code: 'INSTAGRAM_CAROUSEL_MAX', message: 'You can add up to 9 images.', status: 400 };
    try {
      slides = await Promise.all(slides.map((url) => prepareInstagramMedia(url)));
      const childIds = [];
      for (let i = 0; i < slides.length; i++) {
        const childRes = await fetch(`${GRAPH}/${ig.igUserId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...altPayload('instagram', 'image', mediaAlt(mediaList, orderedUrls[i], i)), image_url: slides[i], is_carousel_item: true, access_token: ig.token }) });
        if (!childRes.ok) { const { code, message } = graphError(childRes.status, await childRes.text(), `carousel slide ${i + 1}/${slides.length}`); return { ok: false, code, message: `${message} The post was NOT published.`, status: childRes.status === 429 ? 429 : 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) }; }
        const childData = await childRes.json();
        if (!childData.id) return { ok: false, code: 'INSTAGRAM_MEDIA_UPLOAD_FAILED', message: `Instagram did not return a container id for slide ${i + 1}. The post was NOT published.`, status: 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) };
        await waitForContainer(childData.id, ig.token);
        childIds.push(childData.id);
      }
      const parentBody = { media_type: 'CAROUSEL', children: childIds, caption: content || '', access_token: ig.token };
      // Collaborators go ONLY on the carousel PARENT container (Meta does not
      // take them on carousel children); when empty, no field is sent.
      if (collaboratorUsernames) parentBody.collaborators = collaboratorUsernames;
      const parentRes = await fetch(`${GRAPH}/${ig.igUserId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parentBody) });
      if (!parentRes.ok) { const { code, message } = graphError(parentRes.status, await parentRes.text(), 'carousel container creation', collaboratorUsernames); return { ok: false, code, message: `${message} The post was NOT published.`, status: parentRes.status === 429 ? 429 : 502, collaboratorResults: collaboratorResults(collaboratorList, false, code === 'INSTAGRAM_COLLAB_REJECTED') }; }
      const parentData = await parentRes.json();
      if (!parentData.id) return { ok: false, code: 'INSTAGRAM_MEDIA_UPLOAD_FAILED', message: 'Instagram did not return a carousel container id. The post was NOT published.', status: 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) };
      await waitForContainer(parentData.id, ig.token);
      const publishRes = await fetch(`${GRAPH}/${ig.igUserId}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: parentData.id, access_token: ig.token }) });
      if (!publishRes.ok) { const { code, message } = graphError(publishRes.status, await publishRes.text(), 'carousel publish'); return { ok: false, code, message, status: publishRes.status === 429 ? 429 : 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) }; }
      const publishData = await publishRes.json();
      const postUrl = needsPermalink ? await fetchPermalink(publishData.id, ig.token) : undefined;
      return { ok: true, postId: publishData.id, message: `Carousel published to Instagram (${slides.length} slides)!`, collaboratorResults: collaboratorResults(collaboratorList, true, false), postUrl };
    } catch (e) {
      return { ok: false, code: 'INSTAGRAM_PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Instagram carousel failed; no retry was attempted.', status: 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) };
    }
  }

  try {
    rawMedia = await prepareInstagramMedia(rawMedia, resolvedType === 'video');
    const containerBody = { caption: content || '', access_token: ig.token };
    if (resolvedType === 'video') {
      containerBody.video_url = rawMedia;
      containerBody.media_type = 'REELS';
      if (collaboratorUsernames) containerBody.collaborators = collaboratorUsernames;
    } else {
      containerBody.image_url = rawMedia;
      Object.assign(containerBody, altPayload('instagram', 'image', mediaAlt(mediaList, orderedUrls[0] || mediaUrl || imageUrl || '')));
      if (collaboratorUsernames) containerBody.collaborators = collaboratorUsernames;
    }
    const containerRes = await fetch(`${GRAPH}/${ig.igUserId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(containerBody) });
    if (!containerRes.ok) { const { code, message } = graphError(containerRes.status, await containerRes.text(), 'media container creation', collaboratorUsernames); return { ok: false, code, message: `${message} The post was NOT published.`, status: containerRes.status === 429 ? 429 : 502, collaboratorResults: collaboratorResults(collaboratorList, false, code === 'INSTAGRAM_COLLAB_REJECTED') }; }
    const containerData = await containerRes.json();
    const containerId = containerData.id;
    if (!containerId) return { ok: false, code: 'INSTAGRAM_MEDIA_UPLOAD_FAILED', message: 'Instagram did not return a media container id. The post was NOT published.', status: 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) };
    await waitForContainer(containerId, ig.token);
    const publishRes = await fetch(`${GRAPH}/${ig.igUserId}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: containerId, access_token: ig.token }) });
    if (!publishRes.ok) { const { code, message } = graphError(publishRes.status, await publishRes.text(), 'publish'); return { ok: false, code, message, status: publishRes.status === 429 ? 429 : 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) }; }
    const publishData = await publishRes.json();
    const postUrl = needsPermalink ? await fetchPermalink(publishData.id, ig.token) : undefined;
    return { ok: true, postId: publishData.id, message: 'Post published to Instagram!', collaboratorResults: collaboratorResults(collaboratorList, true, false), postUrl };
  } catch (e) {
    return { ok: false, code: 'INSTAGRAM_PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Instagram publishing failed; no retry was attempted.', status: 502, collaboratorResults: collaboratorResults(collaboratorList, false, false) };
  }
}
