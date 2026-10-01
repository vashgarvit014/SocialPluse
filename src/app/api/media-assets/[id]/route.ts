import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { getMediaAsset, deleteMediaAsset, readMediaAssetBytes } from '@/lib/media-assets';
import { logSystem } from '@/lib/system-log';

// GET /api/media-assets/[id] — serves bytes to the OWNER only.
//
// Ownership is resolved inside getMediaAsset(userId, id), so a guessed id from
// another user is indistinguishable from one that does not exist (both 404).
// Returning 403 here would confirm that someone else's asset id is real.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const asset = await getMediaAsset(session.userId, id);
  if (!asset) {
    logSystem({
      level: 'WARN', category: 'MEDIA', event: 'UNAUTHORIZED_RESOURCE_ACCESS_ATTEMPT',
      userId: session.userId, resourceId: id, message: 'Asset not found for this user',
    });
    return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  }

  const bytes = await readMediaAssetBytes(asset);
  if (!bytes) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': asset.mime,
      'Content-Length': String(bytes.length),
      // `private` matters: this response is per-user and must not be written
      // into a shared cache where a later session could read it back.
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${asset.filename.replace(/"/g, '')}"`,
    },
  });
}

// DELETE /api/media-assets/[id] — soft-deletes the owner's own asset and
// removes the stored bytes. Logs metadata only, never the deleted content.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const deleted = await deleteMediaAsset(session.userId, id);
  if (!deleted) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });

  logSystem({
    level: 'INFO', category: 'MEDIA', event: 'MEDIA_DELETED', userId: session.userId, resourceId: id,
    message: `Deleted ${deleted.filename}`,
    metadata: { filename: deleted.filename, size: deleted.size, type: deleted.type, source: deleted.source },
  });
  return NextResponse.json({ success: true });
}