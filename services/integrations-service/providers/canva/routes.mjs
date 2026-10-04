import { randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { parseCookies } from '../../packages/cookies/index.mjs';
import { startReturn, finishReturn, clearReturnCookie } from '../../src/oauth-return.mjs';
import * as canva from './canva.mjs';
import { createHandoffStore } from './handoffs.mjs';

// Canva's own JWKS — identical host/comment as src/app/api/canva/return/route.ts
// (api.canva.com, not www.canva.com — the latter 403s here).
const JWKS = createRemoteJWKSet(new URL('https://api.canva.com/rest/v1/connect/keys'));

const MIN_DIM = 40;
const MAX_DIM = 8000;
const MAX_AREA = 25_000_000;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
function canvaErrorStatus(code) {
  return code === 'CANVA_NOT_CONNECTED' ? 401 : code === 'CANVA_AUTH_FAILED' || code === 'CANVA_STATE_MISMATCH' ? 400 : 502;
}

// Routes requiring a known SocialPulse user — identity comes from the
// gateway's x-actor-user-id header (set only after its own verify-session
// call succeeds; see infrastructure/gateway/src/server.mjs). /callback is
// the one deliberate exception — see below.
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

export function createCanvaRouter(pool) {
  const handoffs = createHandoffStore(pool);

  return async function handleCanvaRoute(pathname, req, res, { requestId, isHttps }) {
    const url = new URL(req.url, 'http://internal');
    const cookies = parseCookies(req.headers.cookie || '');

    // --- GET /auth — start OAuth2 + PKCE ---
    if (pathname === '/auth' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const state = randomBytes(16).toString('hex');
      const codeVerifier = canva.generateCodeVerifier();
      const codeChallenge = canva.codeChallengeFromVerifier(codeVerifier);
      await handoffs.savePkceVerifier(userId, state, codeVerifier);
      startReturn(cookies, res, state, isHttps);
      return redirect(res, canva.buildAuthorizeUrl(state, codeChallenge));
    }

    // --- GET /callback — Canva's redirect back. Deliberately NO actor
    // requirement: identity comes from the PKCE row keyed by `state`, exactly
    // as src/app/api/canva/callback/route.ts does (the browser's SocialPulse
    // session is not guaranteed/used on this hop). ---
    if (pathname === '/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      const fail = (errCode) => {
        const target = finishReturn(req.headers.cookie || '', state, new URL(`/dashboard?error=${errCode}`, canva.APP_ORIGIN));
        clearReturnCookie(res, isHttps);
        return redirect(res, target.toString());
      };
      if (oauthError) return fail('CANVA_AUTH_FAILED');
      if (!code || !state) return fail('CANVA_STATE_MISMATCH');

      const handoff = await handoffs.takePkceVerifierUser(state);
      const userId = handoff?.userId;
      const codeVerifier = handoff?.data?.codeVerifier;
      if (!userId || !codeVerifier) return fail('CANVA_STATE_MISMATCH');

      try {
        const token = await canva.exchangeCodeForToken(code, codeVerifier);
        const { displayName } = await canva.getCanvaProfile(token.access_token);
        const target = finishReturn(req.headers.cookie || '', state, new URL(`/dashboard?canva_connected=true&canva_name=${encodeURIComponent(displayName)}`, canva.APP_ORIGIN));
        clearReturnCookie(res, isHttps);
        canva.setTokenCookies(res, token);
        return redirect(res, target.toString());
      } catch (err) {
        console.error('[integrations-service] Canva callback error:', err instanceof Error ? err.message : err);
        return fail(err instanceof canva.CanvaError ? err.code : 'CANVA_AUTH_FAILED');
      }
    }

    // --- GET /return — Canva's return-navigation after editing ---
    if (pathname === '/return' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const correlationJwt = url.searchParams.get('correlation_jwt');
      const fail = (code) => redirect(res, new URL(`/canva-return?error=${code}`, canva.APP_ORIGIN).toString());
      if (!correlationJwt) return fail('CANVA_IMPORT_FAILED');
      try {
        const { payload } = await jwtVerify(correlationJwt, JWKS, { audience: canva.CANVA_CLIENT_ID });
        const designId = payload.design_id;
        const correlationState = payload.correlation_state;
        if (!designId) return fail('CANVA_IMPORT_FAILED');
        const expectedDesignId = correlationState ? await handoffs.takePendingDesign(userId, correlationState) : null;
        const matchedDesignId = expectedDesignId ?? (await handoffs.takePendingDesignById(userId, designId));
        if (!matchedDesignId || matchedDesignId !== designId) return fail('CANVA_IMPORT_FAILED');
        const readyId = randomBytes(16).toString('hex');
        await handoffs.saveReadyDesign(userId, readyId, designId);
        return redirect(res, new URL(`/canva-return?canva_ready=${readyId}`, canva.APP_ORIGIN).toString());
      } catch (err) {
        console.error('[integrations-service] Canva return-navigation error:', err instanceof Error ? err.message : err);
        return fail('CANVA_IMPORT_FAILED');
      }
    }

    // --- GET /status ---
    if (pathname === '/status' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const accessToken = cookies.canva_access_token;
      const refreshToken = cookies.canva_refresh_token;
      const expiresAt = cookies.canva_expires_at;
      if (!accessToken && !refreshToken) return json(res, 200, { connected: false });
      try {
        const { accessToken: valid, refreshed } = await canva.getValidAccessToken({ accessToken, refreshToken, expiresAt });
        const { displayName } = await canva.getCanvaProfile(valid);
        if (refreshed) canva.setTokenCookies(res, refreshed);
        return json(res, 200, { connected: true, displayName });
      } catch (e) {
        if (!(e instanceof canva.CanvaError) || e.code !== 'CANVA_TOKEN_EXPIRED') canva.clearTokenCookies(res);
        return json(res, 200, { connected: false });
      }
    }

    // --- POST /disconnect ---
    if (pathname === '/disconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      canva.clearTokenCookies(res);
      return json(res, 200, { connected: false, success: true });
    }

    // --- POST /create-design ("Edit in Canva") ---
    if (pathname === '/create-design' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        const { imageData, width, height, title } = await readJsonBody(req);
        if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:')) {
          return json(res, 400, { error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: 'imageData (data URL) is required' } });
        }
        const w = Math.round(Number(width)) || 1080;
        const h = Math.round(Number(height)) || 1080;
        if (w < MIN_DIM || h < MIN_DIM || w > MAX_DIM || h > MAX_DIM) {
          return json(res, 400, { error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: `Design dimensions must be between ${MIN_DIM} and ${MAX_DIM}px` } });
        }
        const { accessToken, refreshed } = await canva.getValidAccessToken({
          accessToken: cookies.canva_access_token, refreshToken: cookies.canva_refresh_token, expiresAt: cookies.canva_expires_at,
        });
        const base64 = imageData.split(',')[1] || '';
        const imageBuffer = Buffer.from(base64, 'base64');
        if (imageBuffer.length > 25 * 1024 * 1024) {
          return json(res, 400, { error: { code: 'CANVA_ASSET_UPLOAD_FAILED', message: 'Image is too large for Canva (25MB limit)' } });
        }
        const assetId = await canva.uploadAsset(accessToken, imageBuffer, String(title || 'SocialPulse image').slice(0, 50));
        const verified = await canva.verifyImageAsset(accessToken, assetId);
        if (!verified) throw new canva.CanvaError('CANVA_ASSET_UPLOAD_FAILED', 'Canva did not return a usable image asset');
        const design = await canva.createDesignWithAsset(accessToken, assetId, { width: w, height: h }, String(title || 'SocialPulse design'));
        const correlationState = randomBytes(16).toString('hex');
        await handoffs.savePendingDesign(userId, correlationState, design.id);
        const editUrlObj = new URL(design.editUrl);
        editUrlObj.searchParams.set('correlation_state', correlationState);
        if (refreshed) canva.setTokenCookies(res, refreshed);
        return json(res, 200, { editUrl: editUrlObj.toString(), designId: design.id, success: true });
      } catch (error) {
        console.error('[integrations-service] Canva create-design error:', error instanceof Error ? error.message : error);
        if (error instanceof canva.CanvaError) return json(res, canvaErrorStatus(error.code), { error: { code: error.code, message: error.message } });
        return json(res, 500, { error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: 'Failed to create Canva design' } });
      }
    }

    // --- POST /create-blank ("Create in Canva") ---
    if (pathname === '/create-blank' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        const { width, height, title } = await readJsonBody(req);
        const w = Math.round(Number(width)) || 1080;
        const h = Math.round(Number(height)) || 1080;
        if (w < MIN_DIM || h < MIN_DIM || w > MAX_DIM || h > MAX_DIM || w * h > MAX_AREA) {
          return json(res, 400, { error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: `Design dimensions must be ${MIN_DIM}-${MAX_DIM}px per side, max ${MAX_AREA.toLocaleString()}px² total` } });
        }
        const { accessToken, refreshed } = await canva.getValidAccessToken({
          accessToken: cookies.canva_access_token, refreshToken: cookies.canva_refresh_token, expiresAt: cookies.canva_expires_at,
        });
        const design = await canva.createBlankDesign(accessToken, { width: w, height: h }, String(title || 'SocialPulse design').slice(0, 255));
        const correlationState = randomBytes(16).toString('hex');
        await handoffs.savePendingDesign(userId, correlationState, design.id);
        const editUrlObj = new URL(design.editUrl);
        editUrlObj.searchParams.set('correlation_state', correlationState);
        if (refreshed) canva.setTokenCookies(res, refreshed);
        return json(res, 200, { editUrl: editUrlObj.toString(), designId: design.id, success: true });
      } catch (error) {
        console.error('[integrations-service] Canva create-blank error:', error instanceof Error ? error.message : error);
        if (error instanceof canva.CanvaError) return json(res, canvaErrorStatus(error.code), { error: { code: error.code, message: error.message } });
        return json(res, 500, { error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: 'Failed to create Canva design' } });
      }
    }

    return null; // not a Canva route this router handles
  };
}
