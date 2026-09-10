import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import {
  getValidAccessToken,
  setTokenCookies,
  uploadAsset,
  createDesignWithAsset,
  savePendingDesign,
  CanvaError,
} from '@/lib/canva';

const MIN_DIM = 40;
const MAX_DIM = 8000;

// "Edit in Canva": uploads the current SocialPulse image as a Canva asset and
// creates a design pre-loaded with it, sized to the same aspect ratio the
// user picked in SocialPulse. Hands back an edit URL to send the browser to;
// Canva calls our return-navigation route when the user is done editing.
export async function POST(request: NextRequest) {
  try {
    const { imageData, width, height, title } = await request.json();

    if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:')) {
      return NextResponse.json({ error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: 'imageData (data URL) is required' } }, { status: 400 });
    }
    const w = Math.round(Number(width)) || 1080;
    const h = Math.round(Number(height)) || 1080;
    if (w < MIN_DIM || h < MIN_DIM || w > MAX_DIM || h > MAX_DIM) {
      return NextResponse.json({ error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: `Design dimensions must be between ${MIN_DIM} and ${MAX_DIM}px` } }, { status: 400 });
    }

    const { accessToken, refreshed } = await getValidAccessToken({
      accessToken: request.cookies.get('canva_access_token')?.value,
      refreshToken: request.cookies.get('canva_refresh_token')?.value,
      expiresAt: request.cookies.get('canva_expires_at')?.value,
    });

    const base64 = imageData.split(',')[1] || '';
    const imageBuffer = Buffer.from(base64, 'base64');
    if (imageBuffer.length > 25 * 1024 * 1024) {
      return NextResponse.json({ error: { code: 'CANVA_ASSET_UPLOAD_FAILED', message: 'Image is too large for Canva (25MB limit)' } }, { status: 400 });
    }

    const assetId = await uploadAsset(accessToken, imageBuffer, String(title || 'SocialPulse image').slice(0, 50));
    const design = await createDesignWithAsset(accessToken, assetId, { width: w, height: h }, String(title || 'SocialPulse design'));

    const correlationState = randomBytes(16).toString('hex');
    savePendingDesign(correlationState, design.id);

    // Canva echoes correlation_state back in the return-navigation JWT, but
    // only if it arrives as a proper query param on the edit URL. The edit
    // URL Canva returns can already carry its own query string, so appending
    // with a hardcoded "?" would mangle it (and Canva echoed an empty
    // correlation_state) - set it via the URL API instead.
    const editUrlObj = new URL(design.editUrl);
    editUrlObj.searchParams.set('correlation_state', correlationState);
    const editUrl = editUrlObj.toString();
    const res = NextResponse.json({ editUrl, success: true });
    if (refreshed) setTokenCookies(res, refreshed);
    return res;
  } catch (error) {
    console.error('Canva create-design error:', error);
    if (error instanceof CanvaError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === 'CANVA_NOT_CONNECTED' ? 401 : 502 });
    }
    return NextResponse.json({ error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: 'Failed to create Canva design' } }, { status: 500 });
  }
}
