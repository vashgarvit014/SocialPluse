import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken, setTokenCookies, exportDesignAsPng, CanvaError } from '@/lib/canva';
import { peekReadyDesign, takeReadyDesign } from '@/lib/canva-handoffs';
import { requireApiSession } from '@/lib/auth/api';
import { saveMediaAsset } from '@/lib/media-assets';
import { logSystem } from '@/lib/system-log';

// "Import from Canva" - only runs when the user explicitly clicks it (never
// automatically on return-navigation). Peeks the one-time readyId handed out
// by /api/canva/return, exports the design as PNG, and only consumes the
// readyId after the export succeeds - so a failed import keeps its readyId
// and the user can press "Retry Import". Returns the image inline so the
// caller can push it into mediaItems[] itself.
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { readyId } = await request.json();
    if (!readyId || typeof readyId !== 'string') {
      return NextResponse.json({ error: { code: 'CANVA_IMPORT_FAILED', message: 'readyId is required' } }, { status: 400 });
    }

    // readyId is scoped to the session user: the handoff row is keyed by
    // (user_id, readyId). A readyId belonging to someone else resolves to
    // nothing here rather than importing another user's design.
    const designId = await peekReadyDesign(session.userId, readyId);
    if (!designId) {
      return NextResponse.json({ error: { code: 'CANVA_IMPORT_FAILED', message: 'This Canva design is no longer available to import - try Edit in Canva again' } }, { status: 404 });
    }

    const { accessToken, refreshed } = await getValidAccessToken({
      accessToken: request.cookies.get('canva_access_token')?.value,
      refreshToken: request.cookies.get('canva_refresh_token')?.value,
      expiresAt: request.cookies.get('canva_expires_at')?.value,
    });

    const imageBuffer = await exportDesignAsPng(accessToken, designId);
    // Export succeeded - now consume the one-time readyId so the same design
    // can't be double-imported by accident (repeat imports update in place).
    await takeReadyDesign(session.userId, readyId);

    // Persist the imported design as a real MediaAsset so it lands in the
    // user's Asset Gallery instead of living only as transient frontend state
    // (and disappearing on reload). Owned by the session user, on the standard
    // 30-day retention window like every other asset.
    let asset: { id: string; filename: string } | null = null;
    try {
      const saved = await saveMediaAsset({
        userId: session.userId,
        filename: `canva-${designId}.png`,
        mime: 'image/png',
        bytes: imageBuffer,
        source: 'CANVA_IMPORT',
        width: null,
        height: null,
      });
      asset = { id: saved.id, filename: saved.filename };
      logSystem({
        level: 'SUCCESS', category: 'MEDIA', event: 'MEDIA_IMPORTED', userId: session.userId, resourceId: saved.id,
        message: `Imported design from Canva (${saved.filename})`,
        metadata: { filename: saved.filename, size: saved.size, source: 'CANVA_IMPORT', designId },
      });
    } catch (e) {
      // The import itself succeeded; failing to file it in the gallery must not
      // lose the user's design, so surface the inline image anyway.
      console.error('[canva/export] could not persist imported media:', e instanceof Error ? e.message : e);
    }

    const res = NextResponse.json({ image: `data:image/png;base64,${imageBuffer.toString('base64')}`, success: true, asset });
    if (refreshed) setTokenCookies(res, refreshed);
    return res;
  } catch (error) {
    console.error('Canva export error:', error);
    if (error instanceof CanvaError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === 'CANVA_NOT_CONNECTED' ? 401 : 502 });
    }
    return NextResponse.json({ error: { code: 'CANVA_EXPORT_FAILED', message: 'Failed to export design from Canva' } }, { status: 500 });
  }
}
