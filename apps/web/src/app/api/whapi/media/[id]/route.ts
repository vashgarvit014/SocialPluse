import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { stat } from 'fs/promises';

// Serves media staged by src/lib/whapi-media.ts so Whapi can fetch it over
// public HTTPS. Unguessable random id, no listing, no directory traversal, and
// only the media types Whapi accepts.
const VALID_ID = /^[a-f0-9]{48}\.(png|jpg|webp|mp4|pdf)$/;

const CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!VALID_ID.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ext = id.split('.').pop() as string;
  const path = join(process.cwd(), '.whapi-media', id);
  try {
    const info = await stat(path);
    const bytes = await readFile(path);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': CONTENT_TYPE[ext] || 'application/octet-stream',
        'Content-Length': String(info.size),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
