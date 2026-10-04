import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';
import { createMediaAssetsStore } from './media-assets.mjs';
import { createBrandedVideo } from './ffmpeg-logo.mjs';

// media-service — Asset Gallery storage/retrieval, faithfully ported from
// src/lib/media-assets.ts + src/app/api/media-assets/{,[id]}/route.ts.
//
// STORAGE ROOT: bind-mounts the SAME host directory (./.media-assets) the
// monolith already uses (see docker-compose.yml) — not a forked copy. Both
// containers read/write the identical files, so there is no data migration,
// no divergence risk, and existing user assets are fully visible/deletable
// through this service from day one. A dedicated `media_data` named volume
// is also provisioned (per the migration plan) but not yet the active root
// — see MIGRATION-NOTES.md for why: switching the active root is a real
// data-migration decision that deserves its own verified pass, not a
// side-effect of this extraction.
//
// AI-generation persistence (generate-image) was cut over in Phase 7, and
// branded-video persistence (ffmpeg/logo) in Phase 11 — see
// POST /internal/branded-video below. Canva-import persistence
// (canva/export) is NOT yet ported — that route still calls
// src/lib/media-assets.ts directly in the monolith (documented gap,
// MIGRATION-NOTES.md Phase 11).

const PORT = Number(process.env.PORT || 4004);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/app/.media-assets';
const log = createLogger('media-service');

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.error({ event: 'pool_error', message: err.message }));
  return pool;
}
const store = createMediaAssetsStore({ query: (...args) => getPool().query(...args) }, MEDIA_ROOT);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

// Builds a web-standard Request from the raw Node request so we can reuse
// the platform's own multipart parser (request.formData()) instead of
// adding a dependency — Node 22's global Request/FormData (undici) support
// this the same way Next.js does internally.
function toWebRequest(req) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`http://internal${req.url}`, { method: req.method, headers, body: hasBody ? req : undefined, duplex: hasBody ? 'half' : undefined });
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  if (req.url === '/health') {
    return send(res, 200, { service: 'media-service', status: 'ok', timestamp: new Date().toISOString() });
  }

  const url = new URL(req.url, 'http://internal');

  if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
    return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
  }

  // GET /assets — own active assets; ?all=1 is the Superadmin cross-user
  // view, gated on the actor role the gateway already verified.
  if (url.pathname === '/media-assets' && req.method === 'GET') {
    const userId = requireActor(req);
    if (!userId) return send(res, 401, { error: 'Unauthorized' });
    const all = url.searchParams.get('all') === '1';
    if (all) {
      const role = req.headers['x-actor-role'];
      if (role !== 'SUPERADMIN') return send(res, 403, { error: 'Forbidden' });
      const assets = await store.listMediaAssets('', true);
      return send(res, 200, { assets: assets.map((a) => ({ ...store.toPublicAsset(a), userId: undefined })) });
    }
    const assets = await store.listMediaAssets(userId);
    return send(res, 200, { assets: assets.map(store.toPublicAsset) });
  }

  // POST /assets — multipart upload, field "files" (1-10).
  if (url.pathname === '/media-assets' && req.method === 'POST') {
    const userId = requireActor(req);
    if (!userId) return send(res, 401, { error: 'Unauthorized' });
    let form;
    try {
      form = await toWebRequest(req).formData();
    } catch {
      return send(res, 400, { error: 'Invalid upload body. Send multipart form-data with files.' });
    }
    const files = form.getAll('files').filter((f) => f instanceof File && f.size > 0);
    if (files.length === 0) return send(res, 400, { error: 'No files received.' });
    if (files.length > 10) return send(res, 400, { error: 'Upload at most 10 files at once.' });

    const uploaded = [];
    const failed = [];
    for (const file of files.slice(0, 10)) {
      const filename = store.sanitizeFilename(file.name);
      try {
        const bytes = Buffer.from(await file.arrayBuffer());
        const checked = store.validateUpload(filename, file.type, file.size, bytes);
        if (checked.error) {
          failed.push({ filename, error: checked.error });
          log.warn({ requestId, event: 'upload_rejected', userId, filename, error: checked.error });
          continue;
        }
        const asset = await store.saveMediaAsset({ userId, filename, mime: file.type, bytes, source: 'UPLOAD' });
        uploaded.push({ id: asset.id, filename: asset.filename, type: asset.type, mime: asset.mime, size: asset.size, source: asset.source, createdAt: asset.createdAt, expiresAt: asset.expiresAt });
        log.info({ requestId, event: 'upload_saved', userId, assetId: asset.id, size: asset.size });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed';
        failed.push({ filename, error: msg });
        log.error({ requestId, event: 'upload_failed', userId, filename, message: msg });
      }
    }
    return send(res, failed.length > 0 && uploaded.length === 0 ? 400 : 200, { uploaded, failed });
  }

  // GET /assets/:id — bytes, owner-only.
  const idMatch = url.pathname.match(/^\/media-assets\/([^/]+)$/);
  if (idMatch && req.method === 'GET') {
    const userId = requireActor(req);
    if (!userId) return send(res, 401, { error: 'Unauthorized' });
    const asset = await store.getMediaAsset(userId, idMatch[1]);
    if (!asset) return send(res, 404, { error: 'Asset not found.' });
    const bytes = await store.readMediaAssetBytes(asset);
    if (!bytes) return send(res, 404, { error: 'Asset not found.' });
    res.writeHead(200, {
      'Content-Type': asset.mime,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${asset.filename.replace(/"/g, '')}"`,
    });
    return res.end(bytes);
  }

  // DELETE /assets/:id — owner-only soft delete + file removal.
  if (idMatch && req.method === 'DELETE') {
    const userId = requireActor(req);
    if (!userId) return send(res, 401, { error: 'Unauthorized' });
    const deleted = await store.deleteMediaAsset(userId, idMatch[1]);
    if (!deleted) return send(res, 404, { error: 'Asset not found.' });
    log.info({ requestId, event: 'asset_deleted', userId, assetId: idMatch[1] });
    return send(res, 200, { success: true });
  }

  // POST /internal/assets — service-to-service create (AI/integrations/
  // publishing callers, once cut over — see header comment). userId comes
  // from the request body here rather than x-actor-user-id: the caller is
  // another SERVICE acting on behalf of a user it has already authenticated
  // (e.g. the publish worker), not a browser session relayed by the gateway.
  if (url.pathname === '/internal/assets' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body.userId || !body.filename || !body.mime || !body.bytesBase64) {
        return send(res, 400, { error: 'userId, filename, mime and bytesBase64 are required.' });
      }
      const asset = await store.saveMediaAsset({
        userId: body.userId, filename: body.filename, mime: body.mime,
        bytes: Buffer.from(body.bytesBase64, 'base64'), source: body.source, altText: body.altText ?? null,
        width: body.width ?? null, height: body.height ?? null, durationMs: body.durationMs ?? null,
      });
      return send(res, 200, { asset: store.toPublicAsset(asset) });
    } catch (e) {
      log.error({ requestId, event: 'internal_create_failed', message: e instanceof Error ? e.message : 'unknown' });
      return send(res, 500, { error: 'Failed to persist media asset.' });
    }
  }

  // POST /internal/branded-video — Phase 11: ffmpeg logo-overlay rendering,
  // moved out of the monolith (src/app/api/ffmpeg/logo/route.ts). The
  // monolith's compatibility proxy decodes multipart/data-URL input into
  // base64 buffers and forwards here; all ffmpeg execution and the
  // resulting MediaAsset persistence (source BRANDED) happen only in this
  // service now — the monolith no longer spawns ffmpeg or calls
  // saveMediaAsset itself.
  if (url.pathname === '/internal/branded-video' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body.userId || !body.videoBase64 || !body.logoBase64) {
        return send(res, 400, { error: 'userId, videoBase64 and logoBase64 are required.' });
      }
      const { videoBuffer, asset } = await createBrandedVideo({
        userId: body.userId,
        videoBuffer: Buffer.from(body.videoBase64, 'base64'), videoExt: body.videoExt || 'mp4',
        logoBuffer: Buffer.from(body.logoBase64, 'base64'), logoExt: body.logoExt || 'png',
        position: body.position, scale: body.scale, opacity: body.opacity,
      }, store);
      return send(res, 200, {
        success: true, videoBase64: videoBuffer.toString('base64'), size: videoBuffer.length,
        asset: asset ? { id: asset.id, filename: asset.filename } : null,
      });
    } catch (e) {
      const status = (e && typeof e === 'object' && e.status) || 500;
      log.error({ requestId, event: 'branded_video_failed', message: e instanceof Error ? e.message : 'unknown' });
      return send(res, status, { error: e instanceof Error ? e.message : 'ffmpeg failed' });
    }
  }

  // POST /internal/cleanup-expired — faithful port of
  // scripts/cleanup-expired-media.mjs's core loop. Internal-secret gated,
  // also self-scheduled below (simple interval, not Redis/BullMQ — "keep it
  // simple" per the migration plan; the monolith's `npm run
  // cleanup:expired-media` cron/manual path still works unchanged too,
  // since both operate on the same table/files and the predicate is
  // idempotent).
  if (url.pathname === '/internal/cleanup-expired' && req.method === 'POST') {
    const dryRun = url.searchParams.get('dryRun') === '1';
    try {
      const summary = await store.cleanupExpired({ dryRun });
      log.info({ requestId, event: 'cleanup_run', ...summary });
      return send(res, 200, summary);
    } catch (e) {
      log.error({ requestId, event: 'cleanup_failed', message: e instanceof Error ? e.message : 'unknown' });
      return send(res, 500, { error: 'Cleanup failed.' });
    }
  }

  return send(res, 404, { code: 'NOT_FOUND', message: 'No such media-service route.' });
});

server.listen(PORT, () => log.info({ event: 'listening', port: PORT, mediaRoot: MEDIA_ROOT }));

// Self-scheduled cleanup: once on boot (after a short delay so the DB pool
// is warm) then every 6 hours. A miss here is never catastrophic — expired
// rows just stay hidden-but-unreclaimed until the next pass, and the
// monolith's own npm script remains available as a manual/cron fallback.
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
function runScheduledCleanup() {
  store.cleanupExpired().then((summary) => {
    if (summary.expired > 0) log.info({ event: 'scheduled_cleanup', ...summary });
  }).catch((err) => log.error({ event: 'scheduled_cleanup_failed', message: err instanceof Error ? err.message : 'unknown' }));
}
const cleanupTimer = setInterval(runScheduledCleanup, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();
setTimeout(runScheduledCleanup, 30_000).unref();

function shutdown(signal) {
  log.info({ event: 'shutdown_start', signal });
  server.close(() => {
    (pool ? pool.end() : Promise.resolve()).finally(() => {
      log.info({ event: 'shutdown_complete' });
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
// Safety net found necessary by a real crash during testing elsewhere in
// this migration (publishing-service): an uncaught async error anywhere
// in a request handler is a Node process-level unhandledRejection by
// default, which CRASHES the whole service — taking down every other
// in-flight request too, not just the one that errored. Log and survive.
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
