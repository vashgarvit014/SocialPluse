import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Phase 11 cleanup: this route no longer spawns ffmpeg or persists media
// itself — both moved to media-service (services/media-service/src/
// ffmpeg-logo.mjs), which the Phase 4 media-service extraction never
// covered (it only covered media-assets CRUD). This route now only
// translates the request shape (multipart form OR JSON data-URLs) into
// the base64 envelope media-service's internal endpoint expects, and
// relays the response back unchanged — no ffmpeg execution, no
// saveMediaAsset call happens here anymore.
const MEDIA_SERVICE_URL = process.env.MEDIA_SERVICE_URL || 'http://media-service:4004';

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'bin';
  return { buffer, ext };
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
      if (v && typeof v.arrayBuffer === 'function') {
        videoBuffer = Buffer.from(await v.arrayBuffer());
        videoExt = v.name?.split('.').pop() || 'mp4';
      } else if (v2) {
        const dec = dataUrlToBuffer(v2);
        videoBuffer = dec.buffer;
        videoExt = dec.ext;
      }
      if (l && typeof l.arrayBuffer === 'function') {
        logoBuffer = Buffer.from(await l.arrayBuffer());
        logoExt = l.name?.split('.').pop() || 'png';
      } else if (l2) {
        const dec = dataUrlToBuffer(l2);
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
      const vDec = dataUrlToBuffer(videoUrl);
      const lDec = dataUrlToBuffer(logoUrl);
      videoBuffer = vDec.buffer;
      videoExt = vDec.ext;
      logoBuffer = lDec.buffer;
      logoExt = lDec.ext;
      if (p) position = p;
      if (s) scale = String(s);
      if (o) opacity = String(o);
    }

    if (!videoBuffer || !logoBuffer) return NextResponse.json({ error: 'Missing video or logo' }, { status: 400 });

    const res = await fetch(`${MEDIA_SERVICE_URL}/internal/branded-video`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET || '' },
      body: JSON.stringify({
        userId: session.userId,
        videoBase64: videoBuffer.toString('base64'), videoExt,
        logoBase64: logoBuffer.toString('base64'), logoExt,
        position, scale, opacity,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: data.error || 'ffmpeg failed' }, { status: res.status });

    const dataUrl = `data:video/mp4;base64,${data.videoBase64}`;
    return NextResponse.json({ success: true, videoUrl: dataUrl, size: data.size, asset: data.asset });
  } catch (err) {
    console.error('[ffmpeg/logo] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ffmpeg failed' }, { status: 500 });
  }
}
