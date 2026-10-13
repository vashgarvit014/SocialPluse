import { randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { parseCookies } from '../../packages/cookies/index.mjs';
import { internalFetchHeaders } from '../../packages/service-auth/index.mjs';
import { startReturn, finishReturn, clearReturnCookie } from '../../src/oauth-return.mjs';
import * as canva from './canva.mjs';
import { createHandoffStore } from './handoffs.mjs';
import { createCanvaVault } from './vault.mjs';

// Canva's own JWKS — identical host/comment as src/app/api/canva/return/route.ts
// (api.canva.com, not www.canva.com — the latter 403s here).
const JWKS = createRemoteJWKSet(new URL('https://api.canva.com/rest/v1/connect/keys'));

const MIN_DIM = 40;
const MAX_DIM = 8000;
const MAX_AREA = 25_000_000;
const MEDIA_SERVICE_URL = process.env.MEDIA_SERVICE_URL || 'http://media-service:4004';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

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
  const vault = createCanvaVault(pool);

  return async function handleCanvaRoute(pathname, req, res, { requestId, isHttps }) {
    const url = new URL(req.url, 'http://internal');
    const cookies = parseCookies(req.headers.cookie || '');

    // --- GET /auth — start OAuth2 + PKCE ---
    if (pathname === '/auth' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      // Fire-and-forget sweep of dead handshakes from previous attempts. Cheap,
      // bounded, and best-effort — see handoffs.pruneExpired for why it lives
      // here rather than in a background job.
      void handoffs.pruneExpired();
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
      // Every early return below burns the verifier: the round-trip is over
      // either way, and leaving the row behind is what let stale rows pile up
      // in oauth_handshakes for every cancelled/malformed attempt.
      if (oauthError) {
        console.error(`[integrations-service] Canva consent rejected by provider: ${oauthError} (${url.searchParams.get('error_description') || 'no description'})`);
        await handoffs.discardPkceVerifier(state);
        return fail('CANVA_AUTH_FAILED');
      }
      if (!code || !state) {
        await handoffs.discardPkceVerifier(state);
        return fail('CANVA_STATE_MISMATCH');
      }

      const handoff = await handoffs.takePkceVerifierUser(state);
      const userId = handoff?.userId;
      const codeVerifier = handoff?.data?.codeVerifier;
      if (!userId || !codeVerifier) {
        // Split from the "no code/state" case above on purpose. A missing or
        // expired verifier is overwhelmingly a TIMEOUT — the user spent too
        // long on Canva's login/consent screens — not a tampering attempt, and
        // telling them "connection could not be verified" sent them looking for
        // a security problem instead of just retrying. The distinction also
        // makes this failure legible in the logs below.
        console.error(`[integrations-service] Canva callback: no live verifier for state (expired or already consumed): ${state}`);
        return fail('CANVA_AUTH_EXPIRED');
      }

      try {
        const token = await canva.exchangeCodeForToken(code, codeVerifier);
        const [{ displayName }, { userId: canvaUserId, teamId }] = await Promise.all([
          canva.getCanvaProfile(token.access_token),
          canva.getCanvaUserId(token.access_token),
        ]);
        const stored = await vault.storeCanvaAuth(
          userId,
          canvaUserId,
          {
            accessToken: token.access_token,
            refreshToken: token.refresh_token || null,
            expiresAt: Date.now() + token.expires_in * 1000,
            scope: token.scope || canva.CANVA_SCOPES,
          },
          { displayName, teamId },
        );
        // This Canva account is already connected to a DIFFERENT SocialPulse
        // user. Refusing to reassign (same rule as LinkedIn/Facebook) is what
        // keeps one user's OAuth from silently taking over another user's
        // connection — their identity is deliberately not revealed here.
        if (!stored.ok) {
          console.error(`[integrations-service] Canva callback: store refused (${stored.reason})`);
          return fail('account_already_connected');
        }
        console.error(`[integrations-service] Canva connected for user ${userId} (canva ${canvaUserId})`);
        const target = finishReturn(req.headers.cookie || '', state, new URL(`/dashboard?canva_connected=true&canva_name=${encodeURIComponent(displayName)}`, canva.APP_ORIGIN));
        clearReturnCookie(res, isHttps);
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
    // Derived entirely from the user's server-side platform_connections row
    // — not cookies — so the same authenticated user sees the same status
    // from any browser/device/session, and a background job could read it
    // too (no browser round-trip required).
    if (pathname === '/status' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const stored = await vault.getCanvaAuth(userId);
      if (!stored) return json(res, 200, { connected: false });
      try {
        const { accessToken: valid, refreshed } = await canva.getValidAccessToken(stored);
        if (refreshed) await vault.updateCanvaCredentials(userId, refreshed);
        // Strict on purpose: a locally-unexpired token can still have been
        // revoked at Canva, and reporting connected:true in that case is what
        // made the UI claim "Connected" while every Canva action failed.
        const { displayName } = await canva.getCanvaProfileStrict(valid);
        return json(res, 200, { connected: true, displayName: displayName || stored.displayName || 'Canva' });
      } catch (e) {
        if (e instanceof canva.CanvaError && (e.code === 'CANVA_NOT_CONNECTED' || e.code === 'CANVA_TOKEN_EXPIRED')) {
          // No usable grant — either the row never had a refresh token, the
          // refresh was rejected, or Canva itself 401'd the access token.
          // Reconnect is required. Leave the (now-unusable) row in place rather
          // than guessing at deletion; the user's next successful /auth will
          // overwrite it via the vault's own-user upsert path.
          return json(res, 200, { connected: false, reason: 'RECONNECT_REQUIRED' });
        }
        console.error('[integrations-service] Canva status check failed:', e instanceof Error ? e.message : e);
        return json(res, 200, { connected: false });
      }
    }

    // --- POST /disconnect ---
    if (pathname === '/disconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const stored = await vault.getCanvaAuth(userId);
      // Revoking the refresh token revokes the whole token lineage at Canva
      // (both access and refresh), so one call is enough when present; fall
      // back to revoking the access token alone otherwise. Best-effort: a
      // failed/unreachable revoke must not block the local disconnect below.
      if (stored?.refreshToken) await canva.revokeToken(stored.refreshToken);
      else if (stored?.accessToken) await canva.revokeToken(stored.accessToken);
      const removed = await vault.deleteCanvaAuth(userId);
      return json(res, 200, { connected: false, success: true, disconnected: removed });
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
        const stored = await vault.getCanvaAuth(userId);
        const { accessToken, refreshed } = await canva.getValidAccessToken(stored);
        if (refreshed) await vault.updateCanvaCredentials(userId, refreshed);
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
        const stored = await vault.getCanvaAuth(userId);
        const { accessToken, refreshed } = await canva.getValidAccessToken(stored);
        if (refreshed) await vault.updateCanvaCredentials(userId, refreshed);
        const design = await canva.createBlankDesign(accessToken, { width: w, height: h }, String(title || 'SocialPulse design').slice(0, 255));
        const correlationState = randomBytes(16).toString('hex');
        await handoffs.savePendingDesign(userId, correlationState, design.id);
        const editUrlObj = new URL(design.editUrl);
        editUrlObj.searchParams.set('correlation_state', correlationState);
        return json(res, 200, { editUrl: editUrlObj.toString(), designId: design.id, success: true });
      } catch (error) {
        console.error('[integrations-service] Canva create-blank error:', error instanceof Error ? error.message : error);
        if (error instanceof canva.CanvaError) return json(res, canvaErrorStatus(error.code), { error: { code: error.code, message: error.message } });
        return json(res, 500, { error: { code: 'CANVA_CREATE_DESIGN_FAILED', message: 'Failed to create Canva design' } });
      }
    }

    // --- POST /export ("Import from Canva") ---
    if (pathname === '/export' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        const { readyId } = await readJsonBody(req);
        if (!readyId || typeof readyId !== 'string') {
          return json(res, 400, { error: { code: 'CANVA_IMPORT_FAILED', message: 'readyId is required' } });
        }

        const designId = await handoffs.peekReadyDesign(userId, readyId);
        if (!designId) {
          return json(res, 404, { error: { code: 'CANVA_IMPORT_FAILED', message: 'This Canva design is no longer available to import - try Edit in Canva again' } });
        }

        const stored = await vault.getCanvaAuth(userId);
        const { accessToken, refreshed } = await canva.getValidAccessToken(stored);
        if (refreshed) await vault.updateCanvaCredentials(userId, refreshed);
        const imageBuffer = await canva.exportDesignAsPng(accessToken, designId);
        await handoffs.takeReadyDesign(userId, readyId);

        let asset = null;
        try {
          const mediaRes = await fetch(`${MEDIA_SERVICE_URL}/internal/assets`, {
            method: 'POST',
            headers: internalFetchHeaders(INTERNAL_SECRET, requestId, { 'content-type': 'application/json' }),
            body: JSON.stringify({
              userId,
              filename: `canva-${designId}.png`,
              mime: 'image/png',
              bytesBase64: imageBuffer.toString('base64'),
              source: 'CANVA_IMPORT',
            }),
          });
          const mediaData = await mediaRes.json().catch(() => ({}));
          if (mediaRes.ok && mediaData.asset) asset = { id: mediaData.asset.id, filename: mediaData.asset.filename };
          else console.error('[integrations-service] Canva export media persistence failed:', mediaData);
        } catch (persistErr) {
          console.error('[integrations-service] Canva export media persistence failed:', persistErr instanceof Error ? persistErr.message : persistErr);
        }

        return json(res, 200, { image: `data:image/png;base64,${imageBuffer.toString('base64')}`, success: true, asset });
      } catch (error) {
        console.error('[integrations-service] Canva export error:', error instanceof Error ? error.message : error);
        if (error instanceof canva.CanvaError) return json(res, canvaErrorStatus(error.code), { error: { code: error.code, message: error.message } });
        return json(res, 500, { error: { code: 'CANVA_EXPORT_FAILED', message: 'Failed to export design from Canva' } });
      }
    }

    return null; // not a Canva route this router handles
  };
}
