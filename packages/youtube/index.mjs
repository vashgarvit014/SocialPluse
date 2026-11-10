const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API_ROOT = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/youtube/v3';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  // videos.update (used to unschedule) accepts none of the read/upload
  // scopes — only youtube, youtube.force-ssl or youtubepartner.
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

// Scopes Google accepts for videos.update. A connection established before
// force-ssl was requested carries none of them and must reconnect.
const VIDEO_WRITE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtubepartner',
];

export function canModifyYouTubeVideos(credentials) {
  const granted = new Set(String(credentials?.scope || '').split(/\s+/).filter(Boolean));
  return VIDEO_WRITE_SCOPES.some((scope) => granted.has(scope));
}

export function youtubeConfig(env = process.env) {
  return {
    clientId: env.YOUTUBE_CLIENT_ID || '',
    clientSecret: env.YOUTUBE_CLIENT_SECRET || '',
    redirectUri: env.YOUTUBE_REDIRECT_URI || '',
    enabled: String(env.YOUTUBE_ENABLED || '').toLowerCase() === 'true',
    allowedEmails: new Set(String(env.YOUTUBE_TEST_USER_EMAILS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)),
  };
}

export function youtubeConfigMissing(config) {
  return [
    !config.clientId && 'YOUTUBE_CLIENT_ID',
    !config.clientSecret && 'YOUTUBE_CLIENT_SECRET',
    !config.redirectUri && 'YOUTUBE_REDIRECT_URI',
  ].filter(Boolean);
}

export function buildYouTubeAuthorizationUrl(config, state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    state,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent select_account',
  }).toString();
  return url.toString();
}

async function readProviderJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error_description || body?.error?.message || body?.error || `YouTube request failed (${response.status}).`);
    error.status = response.status;
    error.providerCode = body?.error?.errors?.[0]?.reason || body?.error || 'YOUTUBE_REQUEST_FAILED';
    throw error;
  }
  return body;
}

export async function exchangeYouTubeCode(config, code, fetchImpl = fetch) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  });
  return readProviderJson(response);
}

export async function refreshYouTubeToken(config, refreshToken, fetchImpl = fetch) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return readProviderJson(response);
}

export function tokenCredentials(token, previous = {}) {
  const now = Date.now();
  return {
    accessToken: token.access_token || previous.accessToken || '',
    refreshToken: token.refresh_token || previous.refreshToken || '',
    expiresAt: token.expires_in ? new Date(now + Number(token.expires_in) * 1000).toISOString() : previous.expiresAt || null,
    tokenType: token.token_type || previous.tokenType || 'Bearer',
    scope: token.scope || previous.scope || YOUTUBE_SCOPES.join(' '),
  };
}

export function tokenNeedsRefresh(credentials, now = Date.now()) {
  const expiry = Date.parse(credentials?.expiresAt || '');
  return !credentials?.accessToken || (Number.isFinite(expiry) && expiry <= now + 60_000);
}

export async function listMyYouTubeChannels(accessToken, fetchImpl = fetch) {
  const url = new URL(`${API_ROOT}/channels`);
  url.search = new URLSearchParams({ part: 'snippet,status', mine: 'true', maxResults: '50' }).toString();
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await readProviderJson(response);
  return (Array.isArray(data.items) ? data.items : []).map((item) => ({
    id: String(item.id || ''),
    name: String(item.snippet?.title || ''),
    thumbnail: item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url || '',
    privacyStatus: item.status?.privacyStatus || null,
  })).filter((channel) => channel.id);
}

export async function revokeYouTubeToken(token, fetchImpl = fetch) {
  if (!token) return false;
  const response = await fetchImpl(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  return response.ok;
}

export function validateYouTubeMetadata(input, now = Date.now()) {
  const title = String(input?.title || '').trim();
  const description = String(input?.description || '').trim();
  const tags = (Array.isArray(input?.tags) ? input.tags : String(input?.tags || '').split(','))
    .map((tag) => String(tag).trim().replace(/^#+/, '')).filter(Boolean).slice(0, 30);
  const privacyStatus = ['private', 'unlisted', 'public'].includes(input?.privacyStatus) ? input.privacyStatus : 'private';
  if (!title) return { ok: false, code: 'YOUTUBE_TITLE_REQUIRED', message: 'A YouTube title is required.' };
  if (title.length > 100) return { ok: false, code: 'YOUTUBE_TITLE_TOO_LONG', message: 'YouTube titles can be at most 100 characters.' };
  if (description.length > 5000) return { ok: false, code: 'YOUTUBE_DESCRIPTION_TOO_LONG', message: 'YouTube descriptions can be at most 5,000 characters.' };
  if (tags.join(',').length > 500) return { ok: false, code: 'YOUTUBE_TAGS_TOO_LONG', message: 'YouTube tags are too long.' };
  let publishAt = null;
  if (input?.publishAt) {
    const when = Date.parse(input.publishAt);
    if (!Number.isFinite(when) || when <= now + 5 * 60_000) return { ok: false, code: 'YOUTUBE_SCHEDULE_INVALID', message: 'Choose a schedule at least five minutes in the future.' };
    publishAt = new Date(when).toISOString();
  }
  return {
    ok: true,
    value: { title, description, tags, privacyStatus: publishAt ? 'private' : privacyStatus, requestedPrivacyStatus: privacyStatus, publishAt, madeForKids: input?.madeForKids === true },
  };
}

export async function initiateYouTubeResumableUpload({ accessToken, metadata, mimeType, size }, fetchImpl = fetch) {
  const url = new URL(`${UPLOAD_ROOT}/videos`);
  url.search = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status' }).toString();
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(size),
      'x-upload-content-type': mimeType,
    },
    body: JSON.stringify({
      snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags },
      status: {
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: metadata.madeForKids,
        ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}),
      },
    }),
    redirect: 'manual',
  });
  if (!response.ok) await readProviderJson(response);
  const location = response.headers.get('location');
  if (!location?.startsWith('https://')) throw new Error('YouTube did not return a resumable upload URL.');
  return location;
}

export async function getYouTubeVideo(accessToken, videoId, fetchImpl = fetch) {
  const url = new URL(`${API_ROOT}/videos`);
  url.search = new URLSearchParams({ part: 'snippet,status,processingDetails', id: videoId }).toString();
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await readProviderJson(response);
  return data.items?.[0] || null;
}

// videos.update REPLACES the parts it is given: any status field omitted here
// is reset to its default, so the current status is read first and carried
// over. publishAt is deliberately dropped — that is what clears the schedule.
export async function cancelScheduledYouTubeVideo(accessToken, videoId, fetchImpl = fetch) {
  const video = await getYouTubeVideo(accessToken, videoId, fetchImpl);
  if (!video) {
    const error = new Error('That video no longer exists on YouTube.');
    error.code = 'YOUTUBE_VIDEO_NOT_FOUND';
    throw error;
  }
  const status = video.status || {};
  const stillScheduled = status.publishAt && Date.parse(status.publishAt) > Date.now();
  if (status.privacyStatus === 'public' && !stillScheduled) {
    const error = new Error('That video is already public on YouTube; cancelling would unpublish it.');
    error.code = 'YOUTUBE_ALREADY_PUBLISHED';
    throw error;
  }
  const response = await fetchImpl(`${API_ROOT}/videos?part=status`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: videoId,
      status: {
        privacyStatus: 'private',
        selfDeclaredMadeForKids: (status.selfDeclaredMadeForKids ?? status.madeForKids) === true,
        ...(status.license ? { license: status.license } : {}),
        ...(typeof status.embeddable === 'boolean' ? { embeddable: status.embeddable } : {}),
        ...(typeof status.publicStatsViewable === 'boolean' ? { publicStatsViewable: status.publicStatsViewable } : {}),
      },
    }),
  });
  return readProviderJson(response);
}
