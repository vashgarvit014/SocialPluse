import { readInstagramMedia } from '@/lib/instagram-media';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bytes = await readInstagramMedia(id);
  if (!bytes) return new Response(null, { status: 404 });
  const headers = {
    'Content-Type': id.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : -1;
    const end = match?.[2] ? Number(match[2]) : bytes.length - 1;
    if (start < 0 || start > end || end >= bytes.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Length': String(bytes.length) } });
}
