import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken, setTokenCookies, exportDesignAsPng, peekReadyDesign, takeReadyDesign, CanvaError } from '@/lib/canva';

// "Import from Canva" - only runs when the user explicitly clicks it (never
// automatically on return-navigation). Peeks the one-time readyId handed out
// by /api/canva/return, exports the design as PNG, and only consumes the
// readyId after the export succeeds - so a failed import keeps its readyId
// and the user can press "Retry Import". Returns the image inline so the
// caller can push it into mediaItems[] itself.
export async function POST(request: NextRequest) {
  try {
    const { readyId } = await request.json();
    if (!readyId || typeof readyId !== 'string') {
      return NextResponse.json({ error: { code: 'CANVA_IMPORT_FAILED', message: 'readyId is required' } }, { status: 400 });
    }

    const designId = peekReadyDesign(readyId);
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
    takeReadyDesign(readyId);
    const res = NextResponse.json({ image: `data:image/png;base64,${imageBuffer.toString('base64')}`, success: true });
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
