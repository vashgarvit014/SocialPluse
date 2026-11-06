import { randomUUID } from 'node:crypto';

export function createYouTubeUploadStore(pool) {
  let ready;
  async function ensureSchema() {
    if (!ready) ready = pool.query(`
      CREATE TABLE IF NOT EXISTS youtube_upload_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
        attempt_id TEXT NOT NULL,
        upload_url TEXT NOT NULL,
        metadata JSONB NOT NULL,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes_total BIGINT NOT NULL,
        bytes_uploaded BIGINT NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('INITIATED','UPLOADING','PROCESSING','SCHEDULED','PUBLISHED','PRIVATE','FAILED','CANCELLED')),
        provider_video_id TEXT,
        provider_status JSONB,
        error_code TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        UNIQUE(user_id, attempt_id)
      )
    `);
    return ready;
  }

  return {
    ensureSchema,
    async findByAttempt(userId, attemptId) {
      await ensureSchema();
      const { rows } = await pool.query('SELECT * FROM youtube_upload_sessions WHERE user_id = $1 AND attempt_id = $2 LIMIT 1', [userId, attemptId]);
      return rows[0] || null;
    },
    async create({ userId, connectionId, attemptId, uploadUrl, metadata, filename, mime, bytesTotal }) {
      await ensureSchema();
      const now = new Date();
      const { rows } = await pool.query(
        `INSERT INTO youtube_upload_sessions
          (id,user_id,connection_id,attempt_id,upload_url,metadata,filename,mime,bytes_total,bytes_uploaded,status,created_at,updated_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'INITIATED',$10,$10,$11)
         ON CONFLICT (user_id, attempt_id) DO NOTHING RETURNING *`,
        [randomUUID(), userId, connectionId, attemptId, uploadUrl, JSON.stringify(metadata), filename, mime, bytesTotal, now.toISOString(), new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()],
      );
      return rows[0] || this.findByAttempt(userId, attemptId);
    },
    async get(userId, id) {
      await ensureSchema();
      const { rows } = await pool.query('SELECT * FROM youtube_upload_sessions WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
      return rows[0] || null;
    },
    async progress(userId, id, bytesUploaded) {
      const { rows } = await pool.query(
        `UPDATE youtube_upload_sessions SET bytes_uploaded = $3, status = 'UPLOADING', updated_at = $4
          WHERE id = $1 AND user_id = $2 AND status IN ('INITIATED','UPLOADING') RETURNING *`,
        [id, userId, bytesUploaded, new Date().toISOString()],
      );
      return rows[0] || null;
    },
    async complete(userId, id, videoId, providerStatus) {
      const metadata = providerStatus?.status || {};
      const status = providerStatus?.processingDetails?.processingStatus === 'processing'
        ? 'PROCESSING'
        : metadata.publishAt ? 'SCHEDULED'
          : metadata.privacyStatus === 'public' ? 'PUBLISHED' : 'PRIVATE';
      const { rows } = await pool.query(
        `UPDATE youtube_upload_sessions SET bytes_uploaded = bytes_total, status = $3, provider_video_id = $4,
                provider_status = $5, upload_url = '', updated_at = $6
          WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId, status, videoId, JSON.stringify(providerStatus || {}), new Date().toISOString()],
      );
      return rows[0] || null;
    },
    async reconcile(userId, id, providerStatus) {
      const statusData = providerStatus?.status || {};
      const processing = providerStatus?.processingDetails?.processingStatus;
      const status = processing === 'failed' ? 'FAILED'
        : processing === 'processing' ? 'PROCESSING'
          : statusData.publishAt && Date.parse(statusData.publishAt) > Date.now() ? 'SCHEDULED'
            : statusData.privacyStatus === 'public' ? 'PUBLISHED' : 'PRIVATE';
      const { rows } = await pool.query(
        `UPDATE youtube_upload_sessions SET status = $3, provider_status = $4, updated_at = $5
          WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId, status, JSON.stringify(providerStatus || {}), new Date().toISOString()],
      );
      return rows[0] || null;
    },
    async fail(userId, id, code, message) {
      await pool.query(
        `UPDATE youtube_upload_sessions SET status = 'FAILED', error_code = $3, error_message = $4,
                upload_url = '', updated_at = $5 WHERE id = $1 AND user_id = $2`,
        [id, userId, code, message, new Date().toISOString()],
      );
    },
    async cancel(userId, id) {
      const { rows } = await pool.query(
        `UPDATE youtube_upload_sessions SET status = 'CANCELLED', upload_url = '', updated_at = $3
          WHERE id = $1 AND user_id = $2 AND status NOT IN ('PUBLISHED','CANCELLED') RETURNING *`,
        [id, userId, new Date().toISOString()],
      );
      return rows[0] || null;
    },
  };
}

export function publicUpload(row) {
  if (!row) return null;
  return {
    id: row.id,
    attemptId: row.attempt_id,
    filename: row.filename,
    bytesTotal: Number(row.bytes_total),
    bytesUploaded: Number(row.bytes_uploaded),
    progress: Number(row.bytes_total) ? Math.round(Number(row.bytes_uploaded) / Number(row.bytes_total) * 100) : 0,
    status: row.status,
    videoId: row.provider_video_id || null,
    videoUrl: row.provider_video_id ? `https://www.youtube.com/watch?v=${encodeURIComponent(row.provider_video_id)}` : null,
    privacyStatus: row.provider_status?.status?.privacyStatus || row.metadata?.privacyStatus || null,
    publishAt: row.provider_status?.status?.publishAt || row.metadata?.publishAt || null,
    error: row.error_message || null,
  };
}
