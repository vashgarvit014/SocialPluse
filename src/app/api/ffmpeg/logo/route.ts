import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Next.js App Router: increase body limit via route segment config is not needed for formData, but we handle large via stream

function getFfmpegPath(): string {
  // Try require, then cwd fallback (handles spaces in path like "ALONEai copy")
  const candidates: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string;
    if (p) candidates.push(p);
  } catch {}
  candidates.push(join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'));
  candidates.push(join(process.cwd(), 'node_modules', '.bin', 'ffmpeg'));
  candidates.push('/opt/homebrew/bin/ffmpeg');
  candidates.push('ffmpeg');
  for (const c of candidates) {
    try { if (c && existsSync(c)) return c; } catch {}
  }
  return candidates[0] || 'ffmpeg';
}

function positionToOverlay(pos: string, pad = 12) {
  // Returns overlay x:y expression for ffmpeg
  switch (pos) {
    case 'top-left': return `overlay=${pad}:${pad}`;
    case 'top-right': return `overlay=W-w-${pad}:${pad}`;
    case 'bottom-left': return `overlay=${pad}:H-h-${pad}`;
    case 'bottom-right': return `overlay=W-w-${pad}:H-h-${pad}`;
    case 'center': return `overlay=(W-w)/2:(H-h)/2`;
    default: return `overlay=W-w-${pad}:H-h-${pad}`;
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = getFfmpegPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(/* turbopackIgnore: true */ ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 800)}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

async function dataUrlToBuffer(dataUrl: string): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');
  const mime = match[1];
  const b64 = match[2];
  const buffer = Buffer.from(b64, 'base64');
  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'bin';
  return { buffer, ext, mime };
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    let videoBuffer: Buffer | null = null;
    let videoExt = 'mp4';
    let logoBuffer: Buffer | null = null;
    let logoExt = 'png';
    let position = 'bottom-right';
    let scale = '0.18';
    let opacity = '1';

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const v = form.get('video') as File | null;
      const l = form.get('logo') as File | null;
      const v2 = form.get('videoUrl') as string | null;
      const l2 = form.get('logoUrl') as string | null;
      if (v && typeof (v as File).arrayBuffer === 'function') {
        const ab = await (v as File).arrayBuffer();
        videoBuffer = Buffer.from(ab);
        // @ts-ignore
        videoExt = (v as File).name?.split('.').pop() || 'mp4';
      } else if (v2) {
        const dec = await dataUrlToBuffer(v2);
        videoBuffer = dec.buffer;
        videoExt = dec.ext;
      }
      if (l && typeof (l as File).arrayBuffer === 'function') {
        const ab = await (l as File).arrayBuffer();
        logoBuffer = Buffer.from(ab);
        // @ts-ignore
        logoExt = (l as File).name?.split('.').pop() || 'png';
      } else if (l2) {
        const dec = await dataUrlToBuffer(l2);
        logoBuffer = dec.buffer;
        logoExt = dec.ext;
      }
      position = (form.get('position') as string) || position;
      scale = (form.get('scale') as string) || scale;
      opacity = (form.get('opacity') as string) || opacity;
    } else {
      const body = await request.json();
      const { videoUrl, logoUrl, position: p, scale: s, opacity: o } = body;
      if (!videoUrl || !logoUrl) return NextResponse.json({ error: 'videoUrl and logoUrl required' }, { status: 400 });
      const vDec = await dataUrlToBuffer(videoUrl);
      const lDec = await dataUrlToBuffer(logoUrl);
      videoBuffer = vDec.buffer;
      videoExt = vDec.ext;
      logoBuffer = lDec.buffer;
      logoExt = lDec.ext;
      if (p) position = p;
      if (s) scale = String(s);
      if (o) opacity = String(o);
    }

    if (!videoBuffer || !logoBuffer) return NextResponse.json({ error: 'Missing video or logo' }, { status: 400 });

    // Guard size: video up to 50MB, logo up to 5MB
    if (videoBuffer.length > 55 * 1024 * 1024) return NextResponse.json({ error: 'Video too large (max 50MB)' }, { status: 413 });
    if (logoBuffer.length > 6 * 1024 * 1024) return NextResponse.json({ error: 'Logo too large (max 5MB)' }, { status: 413 });

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
    // Logo width as ~ scale * 320px baseline, scaled to ~18% of 1080p width ~195px at 0.18; use scale filter
    // We scale logo to width = 220 * (scale/0.18) — keeps consistent across videos
    const targetLogoW = Math.round(220 * (scaleF / 0.18));
    const overlayExpr = positionToOverlay(position, 18);
    // Build filter: scale logo, set opacity via colorchannelmixer, then overlay
    // For opacity <1, we need format=rgba and colorchannelmixer
    const filter = opacityF < 0.99
      ? `[1:v]scale=w=${targetLogoW}:h=-1:flags=lanczos,format=rgba,colorchannelmixer=aa=${opacityF}[logo];[0:v][logo]${overlayExpr}:format=auto:shortest=1`
      : `[1:v]scale=w=${targetLogoW}:h=-1:flags=lanczos[logo];[0:v][logo]${overlayExpr}:format=auto:shortest=1`;

    console.log(`[ffmpeg] Burning logo ${position} scale ${scaleF} opacity ${opacityF} targetW ${targetLogoW} filter ${filter.slice(0, 120)}...`);

    // Run ffmpeg: keep audio, encode video with libx264 fast, keep original if possible
    // Use -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a copy -movflags +faststart
    await runFfmpeg([
      '-y',
      '-i', inVideo,
      '-i', inLogo,
      '-filter_complex', filter,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-shortest',
      outVideo,
    ]);

    const outBuf = await readFile(outVideo);
    // Cleanup
    await Promise.all([unlink(inVideo).catch(() => {}), unlink(inLogo).catch(() => {}), unlink(outVideo).catch(() => {})]);

    const outBase64 = outBuf.toString('base64');
    const dataUrl = `data:video/mp4;base64,${outBase64}`;
    console.log(`[ffmpeg] Done ${Math.round(outBuf.length/1024)}KB`);
    return NextResponse.json({ success: true, videoUrl: dataUrl, size: outBuf.length });
  } catch (err) {
    console.error('[ffmpeg/logo] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ffmpeg failed' }, { status: 500 });
  }
}
