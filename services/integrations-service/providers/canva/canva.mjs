// Faithful port of src/lib/canva.ts for integrations-service (plain Node,
// no Next.js). Same env vars, same endpoints, same PKCE/scopes/cookie
// semantics - nothing here should behave differently from the monolith
// version. See MIGRATION-NOTES.md Phase 3B for why export/media-persistence
// is NOT ported here yet (depends on media-service, not extracted).

import { randomBytes, createHash } from 'node:crypto';

export const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID || '';
export const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET || '';
export const CANVA_REDIRECT_URI = process.env.CANVA_REDIRECT_URI || 'http://127.0.0.1:3001/api/canva/callback';
export const APP_ORIGIN = new URL(CANVA_REDIRECT_URI).origin;
export const CANVA_SCOPES = 'asset:read asset:write design:content:read design:content:write design:meta:read profile:read';

const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const REVOKE_URL = 'https://api.canva.com/rest/v1/oauth/revoke';
const API_BASE = 'https://api.canva.com/rest/v1';

export class CanvaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CanvaError';
  }
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString('base64');
}

export function generateCodeVerifier() {
  return randomBytes(96).toString('base64url');
}

export function codeChallengeFromVerifier(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizeUrl(state, codeChallenge) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CANVA_CLIENT_ID,
    redirect_uri: CANVA_REDIRECT_URI,
    scope: CANVA_SCOPES,
    state,
    code_challenge: codeChallenge,
    // RFC 7636 §4.3 registers the transformation as the token `S256` and
    // states the value is case-sensitive; Canva's parameter spec likewise
    // says this "must be set to S256". Lowercase `s256` appears only in
    // Canva's example URL, where <CODE_CHALLENGE> and `<optional state>` are
    // placeholders — not values to send.
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code, codeVerifier) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: CANVA_REDIRECT_URI }),
  });
  if (!res.ok) {
    console.error('[Canva] token exchange failed:', res.status);
    throw new CanvaError('CANVA_AUTH_FAILED', 'Failed to exchange authorization code for a token');
  }
  return res.json();
}

export async function refreshCanvaToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    console.error('[Canva] token refresh failed:', res.status);
    throw new CanvaError('CANVA_TOKEN_EXPIRED', 'Canva session expired - please reconnect');
  }
  return res.json();
}

export async function getCanvaProfile(accessToken) {
  const res = await fetch(`${API_BASE}/users/me/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return { displayName: 'Canva' };
  const data = await res.json();
  return { displayName: data.profile?.display_name || 'Canva' };
}

// Strict variant, for the places that must NOT paper over an auth failure.
//
// getCanvaProfile() above deliberately swallows every error and falls back to
// the literal string 'Canva', which is right when the display name is just a
// label (the connect callback). It is wrong for /status: that route used the
// lenient call and therefore reported { connected: true } whenever the stored
// token merely LOOKED unexpired locally, even after Canva had revoked it. The
// UI then showed "● Connected" while every Create/Edit/Import failed with a
// confusing downstream error. A 401/403 from Canva is the only trustworthy
// signal that the grant is dead, so surface it as a typed CanvaError instead.
export async function getCanvaProfileStrict(accessToken) {
  const res = await fetch(`${API_BASE}/users/me/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401 || res.status === 403) {
    console.error('[Canva] stored access token rejected:', res.status);
    throw new CanvaError('CANVA_TOKEN_EXPIRED', 'Canva rejected the stored access token - please reconnect');
  }
  if (!res.ok) {
    console.error('[Canva] profile lookup failed (treating as still connected):', res.status);
    return { displayName: '' };
  }
  const data = await res.json();
  return { displayName: data.profile?.display_name || '' };
}

// GET /v1/users/me — requires no scope, returns Canva's own stable identity
// for the authenticated user (team_user.user_id/team_id). This is the
// provider_user_id the vault uses for ownership/cross-user-reuse checks; a
// display name is not a safe identity key (it can collide or be changed).
//
// Called straight after a token exchange, so the token is guaranteed fresh and
// a failure here is almost always transient: Canva rate-limits this endpoint to
// 10 requests per minute per user, and it sits behind the same edge as every
// other Canva call. It therefore retries 429/5xx before giving up. That
// matters because this call gates the WHOLE callback — without a
// provider_user_id the vault cannot store the connection at all, so a single
// blip would otherwise discard a token the user had just successfully
// consented to and force them to start over.
export async function getCanvaUserId(accessToken) {
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      const userId = data.team_user?.user_id;
      if (!userId) throw new CanvaError('CANVA_AUTH_FAILED', 'Canva did not return a user id');
      return { userId, teamId: data.team_user?.team_id || null };
    }
    if (!res) { lastStatus = 0; continue; } // network error — retry
    lastStatus = res.status;
    if (!RETRYABLE.has(res.status)) {
      console.error('[Canva] users/me failed:', res.status);
      throw new CanvaError('CANVA_AUTH_FAILED', 'Failed to identify the Canva account');
    }
    console.error(`[Canva] users/me retryable failure ${res.status} (attempt ${attempt + 1}/3)`);
  }
  throw new CanvaError('CANVA_AUTH_FAILED', `Failed to identify the Canva account (last status ${lastStatus || 'network error'})`);
}

// Best-effort token revocation on disconnect. Revoking a refresh token also
// revokes every access token in its lineage and the user's consent for this
// app (per Canva's /oauth/revoke docs), so one call covers both tokens.
// Never throws — disconnect must still succeed locally even if Canva's
// revoke endpoint is unreachable or the token is already invalid.
export async function revokeToken(token) {
  try {
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (!res.ok) console.error('[Canva] token revoke failed (continuing with local disconnect):', res.status);
  } catch (err) {
    console.error('[Canva] token revoke errored (continuing with local disconnect):', err instanceof Error ? err.message : err);
  }
}

// Returns a usable access token, transparently refreshing if expired.
// `stored` is the row shape returned by vault.getCanvaAuth. Callers must
// persist `refreshed` (via vault.updateCanvaCredentials) when present —
// Canva rotates the refresh token on every use, so the old one stops
// working the moment a new one is issued.
export async function getValidAccessToken(stored) {
  if (!stored) throw new CanvaError('CANVA_NOT_CONNECTED', 'Canva is not connected');
  if (stored.accessToken && stored.expiresAt > Date.now() + 30_000) {
    return { accessToken: stored.accessToken };
  }
  if (!stored.refreshToken) {
    throw new CanvaError('CANVA_NOT_CONNECTED', 'Canva is not connected');
  }
  const refreshed = await refreshCanvaToken(stored.refreshToken);
  return {
    accessToken: refreshed.access_token,
    refreshed: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || stored.refreshToken,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
      scope: refreshed.scope || stored.scope,
    },
  };
}

// --- Asset upload + design creation (needed by create-design/create-blank) ---

export async function uploadAsset(accessToken, imageBuffer, name) {
  const nameBase64 = Buffer.from(name).toString('base64');
  const uploadRes = await fetch(`${API_BASE}/asset-uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream', 'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameBase64 }) },
    body: new Uint8Array(imageBuffer),
  });
  if (!uploadRes.ok) {
    console.error('[Canva] asset upload failed:', uploadRes.status);
    throw new CanvaError('CANVA_ASSET_UPLOAD_FAILED', 'Failed to upload the image to Canva');
  }
  const { job } = await uploadRes.json();
  try {
    return await pollJob(`${API_BASE}/asset-uploads/${job.id}`, accessToken, (j) => j.asset?.id);
  } catch (err) {
    console.error('[Canva] asset upload job failed:', err);
    throw new CanvaError('CANVA_ASSET_UPLOAD_FAILED', 'Canva could not process the uploaded image');
  }
}

export async function createDesignWithAsset(accessToken, assetId, size, title) {
  const res = await fetch(`${API_BASE}/designs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'type_and_asset', design_type: { type: 'custom', width: size.width, height: size.height }, asset_id: assetId, title }),
  });
  if (!res.ok) {
    console.error('[Canva] design creation failed:', res.status);
    throw new CanvaError('CANVA_CREATE_DESIGN_FAILED', 'Failed to create the Canva design');
  }
  const { design } = await res.json();
  if (!design?.id || !design?.urls?.edit_url) throw new CanvaError('CANVA_CREATE_DESIGN_FAILED', 'Canva returned an unusable design');
  return { id: design.id, editUrl: design.urls.edit_url };
}

export async function verifyImageAsset(accessToken, assetId) {
  try {
    const res = await fetch(`${API_BASE}/assets/${assetId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return false;
    const { asset } = await res.json();
    return asset?.type === 'image' && Number(asset?.thumbnail?.width) > 0;
  } catch {
    return false;
  }
}

export async function createBlankDesign(accessToken, size, title) {
  const res = await fetch(`${API_BASE}/designs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'type_and_asset', design_type: { type: 'custom', width: size.width, height: size.height }, title }),
  });
  if (!res.ok) {
    console.error('[Canva] blank design creation failed:', res.status);
    throw new CanvaError('CANVA_CREATE_DESIGN_FAILED', 'Failed to create the Canva design');
  }
  const { design } = await res.json();
  if (!design?.id || !design?.urls?.edit_url) throw new CanvaError('CANVA_CREATE_DESIGN_FAILED', 'Canva returned an unusable design');
  return { id: design.id, editUrl: design.urls.edit_url };
}

export async function exportDesignAsPng(accessToken, designId) {
  const res = await fetch(`${API_BASE}/exports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ design_id: designId, format: { type: 'png' } }),
  });
  if (!res.ok) {
    console.error('[Canva] export job creation failed:', res.status);
    throw new CanvaError('CANVA_EXPORT_FAILED', 'Failed to start exporting the Canva design');
  }
  const { job } = await res.json();

  let downloadUrl;
  try {
    downloadUrl = await pollJob(`${API_BASE}/exports/${job.id}`, accessToken, (j) => j.urls?.[0]);
  } catch (err) {
    console.error('[Canva] export job failed:', err);
    throw new CanvaError('CANVA_EXPORT_FAILED', 'Canva could not finish exporting the design');
  }

  const imageRes = await fetch(downloadUrl);
  if (!imageRes.ok) throw new CanvaError('CANVA_EXPORT_FAILED', 'Failed to download the exported design');
  const buf = Buffer.from(await imageRes.arrayBuffer());
  const pngMagic = buf[0] === 0x89 && buf[1] === 0x50;
  console.log(`[Canva] exported design ${designId}: ${Math.round(buf.length / 1024)}KB png=${pngMagic}${buf.length < 5120 ? ' (SUSPICIOUSLY SMALL - likely blank canvas)' : ''}`);
  return buf;
}

async function pollJob(url, accessToken, extract, { intervalMs = 1500, timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Canva job poll failed: ${res.status}`);
    const { job } = await res.json();
    if (job.status === 'success') {
      const value = extract(job);
      if (value) return value;
      throw new Error('Canva job succeeded but expected field was missing');
    }
    if (job.status === 'failed') throw new Error(`Canva job failed: ${job.error?.message || 'unknown error'}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Canva job timed out');
}
