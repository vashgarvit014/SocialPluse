import {
  canModifyYouTubeVideos,
  cancelScheduledYouTubeVideo,
  getYouTubeVideo,
  initiateYouTubeResumableUpload,
  refreshYouTubeToken,
  tokenCredentials,
  tokenNeedsRefresh,
  validateYouTubeMetadata,
  youtubeConfig,
  youtubeConfigMissing,
} from '../packages/youtube/index.mjs';
import { createYouTubeUploadStore, publicUpload } from './youtube-store.mjs';

const MAX_VIDEO_BYTES = 256 * 1024 * 1024 * 1024;
export const YOUTUBE_CHUNK_SIZE = 8 * 1024 * 1024;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return {}; }
}
function parseRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(value || ''));
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

export function createYouTubeUploadRouter(pool, deps = {}) {
  const config = deps.config || youtubeConfig();
  const fetchImpl = deps.fetchImpl || fetch;
  const store = createYouTubeUploadStore(pool);

  async function featureAccess(userId) {
    if (!config.enabled) return false;
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1 LIMIT 1', [userId]);
    // Same normalization as the allowlist parser (trim + lowercase).
    return config.allowedEmails.has(String(rows[0]?.email || '').trim().toLowerCase());
  }

  async function connection(userId) {
    const { rows } = await pool.query(
      `SELECT id, credentials FROM platform_connections
        WHERE user_id = $1 AND platform = 'youtube' AND disconnected_at IS NULL
        ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    let credentials = row.credentials || {};
    if (tokenNeedsRefresh(credentials)) {
      if (!credentials.refreshToken) return null;
      const refreshed = await refreshYouTubeToken(config, credentials.refreshToken, fetchImpl);
      credentials = tokenCredentials(refreshed, credentials);
      await pool.query('UPDATE platform_connections SET credentials = $2, updated_at = $3 WHERE id = $1', [row.id, JSON.stringify(credentials), new Date().toISOString()]);
    }
    return { ...row, credentials };
  }

  async function syncProviderOffset(userId, row) {
    if (!row?.upload_url || !['INITIATED', 'UPLOADING'].includes(row.status)) return row;
    const response = await fetchImpl(row.upload_url, {
      method: 'PUT',
      headers: { 'content-length': '0', 'content-range': `bytes */${row.bytes_total}` },
      redirect: 'manual',
    });
    if (response.status === 308) {
      const acknowledged = /bytes=0-(\d+)/.exec(response.headers.get('range') || '');
      const offset = acknowledged ? Number(acknowledged[1]) + 1 : 0;
      return await store.progress(userId, row.id, offset) || row;
    }
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.id) return await store.complete(userId, row.id, data.id, data) || row;
    }
    if (response.status === 404 || response.status === 410) {
      await store.fail(userId, row.id, 'YOUTUBE_UPLOAD_SESSION_EXPIRED', 'The YouTube resumable session expired. Start a new upload.');
      return await store.get(userId, row.id);
    }
    return row;
  }

  async function start(req, res, userId) {
    const missing = youtubeConfigMissing(config);
    if (missing.length) return send(res, 503, { success: false, code: 'YOUTUBE_NOT_CONFIGURED', message: `Missing: ${missing.join(', ')}.` });
    if (!(await featureAccess(userId))) return send(res, 403, { success: false, code: 'YOUTUBE_NOT_AVAILABLE', message: 'YouTube is limited to approved test users.' });
    const body = await readJson(req);
    const metadata = validateYouTubeMetadata(body);
    if (!metadata.ok) return send(res, 400, { success: false, ...metadata });
    const size = Number(body.size);
    const mime = String(body.mime || '').toLowerCase();
    const filename = String(body.filename || 'video').slice(0, 180);
    const attemptId = String(body.attemptId || '');
    if (!attemptId || attemptId.length > 160) return send(res, 400, { success: false, code: 'YOUTUBE_ATTEMPT_REQUIRED', message: 'A valid upload attempt id is required.' });
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES) return send(res, 400, { success: false, code: 'YOUTUBE_FILE_SIZE_INVALID', message: 'The video file size is invalid or exceeds YouTube’s 256 GB limit.' });
    if (!mime.startsWith('video/')) return send(res, 400, { success: false, code: 'YOUTUBE_VIDEO_REQUIRED', message: 'Select a supported video file.' });

    const existing = await store.findByAttempt(userId, attemptId);
    if (existing) {
      const synced = await syncProviderOffset(userId, existing).catch(() => existing);
      return send(res, 200, { success: true, upload: publicUpload(synced), chunkSize: YOUTUBE_CHUNK_SIZE, resumed: true });
    }
    // A failed refresh (invalid_grant) is the expected outcome once the
    // Testing-mode refresh token expires; treat it as "not connected" so the
    // user is told to reconnect instead of receiving an opaque 500.
    const auth = await connection(userId).catch(() => null);
    if (!auth) return send(res, 401, { success: false, code: 'YOUTUBE_NOT_CONNECTED', message: 'Reconnect YouTube before uploading.' });
    try {
      const uploadUrl = await initiateYouTubeResumableUpload({ accessToken: auth.credentials.accessToken, metadata: metadata.value, mimeType: mime, size }, fetchImpl);
      const row = await store.create({ userId, connectionId: auth.id, attemptId, uploadUrl, metadata: metadata.value, filename, mime, bytesTotal: size });
      return send(res, 201, { success: true, upload: publicUpload(row), chunkSize: YOUTUBE_CHUNK_SIZE });
    } catch (error) {
      return send(res, error?.status === 403 ? 403 : 502, { success: false, code: error?.providerCode || 'YOUTUBE_UPLOAD_INIT_FAILED', message: error instanceof Error ? error.message : 'Could not start the YouTube upload.' });
    }
  }

  async function chunk(req, res, userId, id) {
    const row = await store.get(userId, id);
    if (!row) return send(res, 404, { success: false, code: 'YOUTUBE_UPLOAD_NOT_FOUND', message: 'Upload not found.' });
    if (!['INITIATED', 'UPLOADING'].includes(row.status) || !row.upload_url) return send(res, 409, { success: false, code: 'YOUTUBE_UPLOAD_NOT_WRITABLE', message: 'This upload can no longer accept data.', upload: publicUpload(row) });
    const range = parseRange(req.headers['content-range']);
    if (!range || range.total !== Number(row.bytes_total) || range.start !== Number(row.bytes_uploaded) || range.end < range.start) {
      return send(res, 409, { success: false, code: 'YOUTUBE_UPLOAD_OFFSET_MISMATCH', message: 'Upload offset does not match the saved resumable session.', expectedOffset: Number(row.bytes_uploaded) });
    }
    const expectedLength = range.end - range.start + 1;
    if (expectedLength > YOUTUBE_CHUNK_SIZE || (range.end + 1 < range.total && expectedLength % (256 * 1024) !== 0)) {
      return send(res, 400, { success: false, code: 'YOUTUBE_CHUNK_INVALID', message: 'Use chunks up to 8 MiB; non-final chunks must be a multiple of 256 KiB.' });
    }
    try {
      const upstream = await fetchImpl(row.upload_url, {
        method: 'PUT',
        headers: { 'content-type': row.mime, 'content-length': String(expectedLength), 'content-range': `bytes ${range.start}-${range.end}/${range.total}` },
        body: req,
        duplex: 'half',
        redirect: 'manual',
      });
      if (upstream.status === 308) {
        const acknowledged = /bytes=0-(\d+)/.exec(upstream.headers.get('range') || '');
        const offset = acknowledged ? Number(acknowledged[1]) + 1 : range.end + 1;
        const updated = await store.progress(userId, id, offset);
        return send(res, 200, { success: true, complete: false, upload: publicUpload(updated) });
      }
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok || !data.id) {
        const providerReason = data?.error?.errors?.[0]?.reason || '';
        const reason = providerReason || data?.error?.message || `YouTube rejected the upload chunk (${upstream.status}).`;
        // YouTube signals quota and rate limits with 403, not 429. Marking
        // those FAILED burned the resumable session over a transient limit.
        const throttled = upstream.status === 429
          || (upstream.status === 403 && ['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(providerReason));
        const retryable = throttled || upstream.status === 401 || upstream.status >= 500;
        if (!retryable) await store.fail(userId, id, 'YOUTUBE_UPLOAD_FAILED', String(reason));
        return send(res, upstream.status === 401 ? 401 : throttled ? 429 : 502, { success: false, code: throttled ? 'YOUTUBE_QUOTA_EXCEEDED' : 'YOUTUBE_UPLOAD_FAILED', message: String(reason) });
      }
      const completed = await store.complete(userId, id, data.id, data);
      return send(res, 200, { success: true, complete: true, upload: publicUpload(completed) });
    } catch (error) {
      return send(res, 502, { success: false, code: 'YOUTUBE_UPLOAD_INTERRUPTED', message: 'Upload interrupted. Retry from the saved offset.', expectedOffset: Number(row.bytes_uploaded), detail: error instanceof Error ? error.message : undefined });
    }
  }

  async function status(res, userId, id) {
    let row = await store.get(userId, id);
    if (!row) return send(res, 404, { success: false, code: 'YOUTUBE_UPLOAD_NOT_FOUND', message: 'Upload not found.' });
    if (['INITIATED', 'UPLOADING'].includes(row.status)) row = await syncProviderOffset(userId, row).catch(() => row);
    if (row.provider_video_id && ['PROCESSING', 'SCHEDULED', 'PUBLISHED', 'PRIVATE'].includes(row.status)) {
      try {
        const auth = await connection(userId);
        if (auth) {
          const video = await getYouTubeVideo(auth.credentials.accessToken, row.provider_video_id, fetchImpl);
          if (video) row = await store.reconcile(userId, id, video);
        }
      } catch { /* saved status remains authoritative until the next poll */ }
    }
    return send(res, 200, { success: true, upload: publicUpload(row) });
  }

  async function cancel(res, userId, id) {
    const row = await store.get(userId, id);
    if (!row) return send(res, 404, { success: false, code: 'YOUTUBE_UPLOAD_NOT_FOUND', message: 'Upload not found.' });
    // store.cancel() refuses PUBLISHED and CANCELLED rows, so calling the
    // provider first would privatize a live video on YouTube and then report
    // the untouched saved status back as a success.
    if (['PUBLISHED', 'CANCELLED'].includes(row.status)) {
      return send(res, 409, { success: false, code: 'YOUTUBE_UPLOAD_NOT_CANCELLABLE', message: 'This upload is already published or cancelled.', upload: publicUpload(row) });
    }
    if (row.provider_video_id) {
      const auth = await connection(userId).catch(() => null);
      if (!auth) return send(res, 401, { success: false, code: 'YOUTUBE_NOT_CONNECTED', message: 'Reconnect YouTube before cancelling the schedule.' });
      // Connections made before youtube.force-ssl was requested cannot call
      // videos.update; ask for a reconnect rather than spending a 403.
      if (!canModifyYouTubeVideos(auth.credentials)) {
        return send(res, 403, { success: false, code: 'YOUTUBE_REAUTH_REQUIRED', message: 'Reconnect YouTube to grant permission to change video settings.', upload: publicUpload(row) });
      }
      try {
        await cancelScheduledYouTubeVideo(auth.credentials.accessToken, row.provider_video_id, fetchImpl);
      } catch (error) {
        // The provider is authoritative: the saved row can lag behind a video
        // that already went public on YouTube.
        if (error?.code === 'YOUTUBE_ALREADY_PUBLISHED') {
          return send(res, 409, { success: false, code: 'YOUTUBE_UPLOAD_NOT_CANCELLABLE', message: error.message, upload: publicUpload(row) });
        }
        if (error?.code === 'YOUTUBE_VIDEO_NOT_FOUND') {
          return send(res, 200, { success: true, upload: publicUpload(await store.cancel(userId, id) || row) });
        }
        const insufficient = error?.status === 403;
        return send(res, insufficient ? 403 : 502, {
          success: false,
          code: insufficient ? 'YOUTUBE_REAUTH_REQUIRED' : 'YOUTUBE_CANCEL_FAILED',
          message: error instanceof Error ? error.message : 'Could not cancel the scheduled video.',
          upload: publicUpload(row),
        });
      }
    }
    const cancelled = await store.cancel(userId, id);
    return send(res, 200, { success: true, upload: publicUpload(cancelled || row) });
  }

  return async function handleYouTubeUpload(pathname, req, res, userId) {
    if (pathname === '/youtube/uploads' && req.method === 'POST') return start(req, res, userId);
    const match = pathname.match(/^\/youtube\/uploads\/([a-f0-9-]{36})$/);
    if (!match) return null;
    if (req.method === 'PUT') return chunk(req, res, userId, match[1]);
    if (req.method === 'GET') return status(res, userId, match[1]);
    if (req.method === 'DELETE') return cancel(res, userId, match[1]);
    return null;
  };
}
