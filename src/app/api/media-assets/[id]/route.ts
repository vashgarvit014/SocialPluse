import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { getMediaAsset, deleteMediaAsset } from '@/lib/media-assets';
import { logSystem } from '@/lib/system-log';

// GET /api/media-assets/[id] — serves bytes to the owner (or any Superadmin).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const found = await getMediaAsset(id);
  if (!found) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  if (found.asset.userId !== session.userId && session.user.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'Content-Type': found.asset.mime,
      'Content-Length': String(found.bytes.length),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// DELETE /api/media-assets/[id] — owner (or any Superadmin). Logs metadata
// only, never the deleted bytes.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const found = await getMediaAsset(id);
  if (!found) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  if (found.asset.userId !== session.userId && session.user.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteMediaAsset(id);
  logSystem({
    level: 'INFO', category: 'MEDIA', event: 'MEDIA_DELETED', userId: session.userId, resourceId: id,
    message: `Deleted ${found.asset.filename}`,
    metadata: { filename: found.asset.filename, size: found.asset.size, type: found.asset.type },
  });
  return NextResponse.json({ success: true });
}
