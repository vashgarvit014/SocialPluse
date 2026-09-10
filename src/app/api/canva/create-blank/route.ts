import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import {
  getValidAccessToken,
  setTokenCookies,
  createBlankDesign,
  savePendingDesign,
  CanvaError,
} from '@/lib/canva';

const MIN_DIM = 40;
const MAX_DIM = 8000;
const MAX_AREA = 25_000_000; // Canva custom-design limit (px²)

// "Create in Canva": starts a BLANK design (no source image) sized to the
// user's aspect ratio, so they can build with Canva's own tools. Shares the
// exact return-navigation chain as "Edit in Canva": pending store ->
// /content-studio -> /api/canva/return -> /canva-return (closes tab) ->
// explicit "Import from Canva" export. Nothing is imported automatically.
export async function POST(request: NextRequest) {
  try {
    const { width, height, title } = await request.json();

    const w = Math.round(Number(width)) || 1080;
    const h = Math.round(Number(height)) || 1080;
    if (w < MIN_DIM || h < MIN_DIM || w > MAX_DIM || h > MAX_DIM || w * h > MAX_AREA) {
      return NextResponse.json({ error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: `Design dimensions must be ${MIN_DIM}-${MAX_DIM}px per side, max ${MAX_AREA.toLocaleString()}px² total` } }, { status: 400 });
    }

    const { accessToken, refreshed } = await getValidAccessToken({
      accessToken: request.cookies.get('canva_access_token')?.value,
      refreshToken: request.cookies.get('canva_refresh_token')?.value,
      expiresAt: request.cookies.get('canva_expires_at')?.value,
    });

    const design = await createBlankDesign(accessToken, { width: w, height: h }, String(title || 'SocialPulse design').slice(0, 255));

    const correlationState = randomBytes(16).toString('hex');
    savePendingDesign(correlationState, design.id);

    // Append as a proper query param (edit URLs may already carry their own
    // query string) so Canva echoes it back in the return JWT.
    const editUrlObj = new URL(design.editUrl);
    editUrlObj.searchParams.set('correlation_state', correlationState);
    const res = NextResponse.json({ editUrl: editUrlObj.toString(), success: true });
    if (refreshed) setTokenCookies(res, refreshed);
    return res;
  } catch (error) {
    console.error('Canva create-blank error:', error);
    if (error instanceof CanvaError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === 'CANVA_NOT_CONNECTED' ? 401 : 502 });
    }
    return NextResponse.json({ error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: 'Failed to create Canva design' } }, { status: 500 });
  }
}
