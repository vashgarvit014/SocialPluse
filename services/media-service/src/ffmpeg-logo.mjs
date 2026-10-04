// Faithful port of src/app/api/ffmpeg/logo/route.ts's ffmpeg logic (Phase
// 11 — this is genuine media-transformation business logic the Phase 4
// media-service extraction never covered; it only covered media-assets
// CRUD, not this route). Multipart/data-URL request parsing stays in the
// monolith's compatibility proxy (it's just request-shape translation, not
// business logic) — this module receives already-decoded buffers and does
// the actual ffmpeg spawn + the resulting MediaAsset persistence, which
// previously happened directly in the monolith.
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

function positionToOverlay(pos, pad = 18) {
  switch (pos) {
    case 'top-left': return `overlay=${pad}:${pad}`;
    case 'top-right': return `overlay=W-w-${pad}:${pad}`;
    case 'bottom-left': return `overlay=${pad}:H-h-${pad}`;
    case 'bottom-right': return `overlay=W-w-${pad}:H-h-${pad}`;
    case 'center': return `overlay=(W-w)/2:(H-h)/2`;
    default: return `overlay=W-w-${pad}:H-h-${pad}`;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 800)}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

// `store` is media-assets.mjs's createMediaAssetsStore(pool, root) instance
// — the SAME store server.mjs already uses for every other media route, so
// this branded render lands in the exact same Asset Gallery, 30-day
// retention, user-scoped storage as everything else. No second persistence
// path.
export async function createBrandedVideo({ userId, videoBuffer, videoExt, logoBuffer, logoExt, position = 'bottom-right', scale = '0.18', opacity = '1' }, store) {
  if (!videoBuffer || !logoBuffer) throw Object.assign(new Error('Missing video or logo'), { status: 400 });
  if (videoBuffer.length > 55 * 1024 * 1024) throw Object.assign(new Error('Video too large (max 50MB)'), { status: 413 });
  if (logoBuffer.length > 6 * 1024 * 1024) throw Object.assign(new Error('Logo too large (max 5MB)'), { status: 413 });

  const tmpDir = join(tmpdir(), 'socialpulse-ffmpeg');
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const inVideo = join(tmpDir, `${id}-in.${videoExt}`);
  const inLogo = join(tmpDir, `${id}-logo.${logoExt}`);
  const outVideo = join(tmpDir, `${id}-out.mp4`);

  await writeFile(inVideo, videoBuffer);
  await writeFile(inLogo, logoBuffer);

  const opacityF = Math.max(0.5, Math.min(1, parseFloat(opacity) || 1));
  const scaleF = Math.max(0.08, Math.min(0.4, parseFloat(scale) || 0.18));
  const targetLogoW = Math.round(220 * (scaleF / 0.18));
  const overlayExpr = positionToOverlay(position, 18);
  const filter = opacityF < 0.99
    ? `[1:v]scale=w=${targetLogoW}:h=-1:flags=lanczos,format=rgba,colorchannelmixer=aa=${opacityF}[logo];[0:v][logo]${overlayExpr}:format=auto:shortest=1`
    : `[1:v]scale=w=${targetLogoW}:h=-1:flags=lanczos[logo];[0:v][logo]${overlayExpr}:format=auto:shortest=1`;

  try {
    await runFfmpeg([
      '-y', '-i', inVideo, '-i', inLogo, '-filter_complex', filter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart', '-shortest', outVideo,
    ]);
    const outBuf = await readFile(outVideo);

    let asset = null;
    try {
      const saved = await store.saveMediaAsset({ userId, filename: `branded-${id}.mp4`, mime: 'video/mp4', bytes: outBuf, source: 'BRANDED' });
      asset = { id: saved.id, filename: saved.filename };
    } catch (e) {
      // Never lose the render because the gallery write failed — the
      // caller still gets the video inline, same as the original route.
      console.error('[media-service/ffmpeg-logo] could not persist branded media:', e instanceof Error ? e.message : e);
    }

    return { videoBuffer: outBuf, asset };
  } finally {
    await Promise.all([unlink(inVideo).catch(() => {}), unlink(inLogo).catch(() => {}), unlink(outVideo).catch(() => {})]);
  }
}

export function dataUrlToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'bin';
  return { buffer, ext, mime };
}
