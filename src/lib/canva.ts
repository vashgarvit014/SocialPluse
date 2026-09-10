import { randomBytes, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Canva Connect API (OAuth2 + PKCE) integration helpers.
// Docs: https://www.canva.dev/docs/connect/

export const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID || '';
export const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET || '';
// Canva's local OAuth requires 127.0.0.1, not localhost, for the redirect URI.
export const CANVA_REDIRECT_URI = process.env.CANVA_REDIRECT_URI || 'http://127.0.0.1:3001/api/canva/callback';
// The app's own origin, derived from CANVA_REDIRECT_URI rather than trusting
// a request's Host header - Next's dev server (bound to 0.0.0.0) can report
// request.url with host 0.0.0.0, which isn't a URL a browser can reliably follow.
export const APP_ORIGIN = new URL(CANVA_REDIRECT_URI).origin;
// Exactly the scopes enabled for this integration in the developer portal -
// requesting anything wider would be rejected (or over-ask consent).
export const CANVA_SCOPES = 'asset:read asset:write design:content:read design:content:write design:meta:read profile:read';

const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const API_BASE = 'https://api.canva.com/rest/v1';

// Structured, non-sensitive error codes surfaced to the frontend - never the
// raw Canva API error body (which can include request context we don't want
// to leak) and never secrets/tokens.
export type CanvaErrorCode =
  | 'CANVA_NOT_CONNECTED'
  | 'CANVA_AUTH_FAILED'
  | 'CANVA_STATE_MISMATCH'
  | 'CANVA_TOKEN_EXPIRED'
  | 'CANVA_ASSET_UPLOAD_FAILED'
  | 'CANVA_CREATE_DESIGN_FAILED'
  | 'CANVA_EXPORT_FAILED'
  | 'CANVA_IMPORT_FAILED';

export class CanvaError extends Error {
  code: CanvaErrorCode;
  constructor(code: CanvaErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CanvaError';
  }
}

export interface CanvaTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString('base64');
}

// --- PKCE ---

export function generateCodeVerifier(): string {
  return randomBytes(96).toString('base64url');
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CANVA_CLIENT_ID,
    redirect_uri: CANVA_REDIRECT_URI,
    scope: CANVA_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<CanvaTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: CANVA_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    console.error('[Canva] token exchange failed:', res.status);
    throw new CanvaError('CANVA_AUTH_FAILED', 'Failed to exchange authorization code for a token');
  }
  return res.json();
}

export async function refreshCanvaToken(refreshToken: string): Promise<CanvaTokenResponse> {
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

export async function getCanvaProfile(accessToken: string): Promise<{ displayName: string }> {
  const res = await fetch(`${API_BASE}/users/me/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return { displayName: 'Canva' };
  const data = await res.json();
  return { displayName: data.profile?.display_name || 'Canva' };
}

// --- Cookie-based server-side token storage (httpOnly - never readable from
// browser JS, never sent to the frontend in a JSON response). ---

export const CANVA_TOKEN_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

interface CookieJar {
  set: (name: string, value: string, opts: object) => void;
  delete?: (name: string) => void;
}

export function setTokenCookies(response: { cookies: CookieJar }, token: CanvaTokenResponse) {
  response.cookies.set('canva_access_token', token.access_token, { ...CANVA_TOKEN_COOKIE_OPTS, maxAge: token.expires_in });
  response.cookies.set('canva_refresh_token', token.refresh_token, { ...CANVA_TOKEN_COOKIE_OPTS, maxAge: 60 * 60 * 24 * 90 });
  response.cookies.set('canva_expires_at', String(Date.now() + token.expires_in * 1000), CANVA_TOKEN_COOKIE_OPTS);
}

export function clearTokenCookies(response: { cookies: CookieJar }) {
  for (const name of ['canva_access_token', 'canva_refresh_token', 'canva_expires_at', 'canva_display_name']) {
    response.cookies.set(name, '', { ...CANVA_TOKEN_COOKIE_OPTS, maxAge: 0 });
  }
}

// Returns a usable access token, transparently refreshing if expired.
// Callers must copy `refreshed` onto their own response's cookies when present.
export async function getValidAccessToken(cookies: {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}): Promise<{ accessToken: string; refreshed?: CanvaTokenResponse }> {
  const expiresAt = Number(cookies.expiresAt || 0);
  if (cookies.accessToken && expiresAt > Date.now() + 30_000) {
    return { accessToken: cookies.accessToken };
  }
  if (!cookies.refreshToken) {
    throw new CanvaError('CANVA_NOT_CONNECTED', 'Canva is not connected');
  }
  const refreshed = await refreshCanvaToken(cookies.refreshToken);
  return { accessToken: refreshed.access_token, refreshed };
}

// --- Asset upload + design creation + export ---

export async function uploadAsset(accessToken: string, imageBuffer: Buffer, name: string): Promise<string> {
  const nameBase64 = Buffer.from(name).toString('base64');
  const uploadRes = await fetch(`${API_BASE}/asset-uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameBase64 }),
    },
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

export async function createDesignWithAsset(  accessToken: string,
  assetId: string,
  size: { width: number; height: number },
  title: string
): Promise<{ id: string; editUrl: string }> {
  const res = await fetch(`${API_BASE}/designs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      design_type: { type: 'custom', width: size.width, height: size.height },
      asset_id: assetId,
      title,
    }),
  });
  if (!res.ok) {
    console.error('[Canva] design creation failed:', res.status);
    throw new CanvaError('CANVA_CREATE_DESIGN_FAILED', 'Failed to create the Canva design');
  }
  const { design } = await res.json();
  return { id: design.id, editUrl: design.urls.edit_url };
}

// Blank design (no source asset): same endpoint, design_type only. Per
// Canva's docs at least one of design_type / asset_id is required -
// design_type alone yields an empty canvas the user fills with Canva's own
// tools. Returns the same { id, editUrl } shape so the return-navigation,
// pending-store, and export chain are reused untouched.
export async function createBlankDesign(
  accessToken: string,
  size: { width: number; height: number },
  title: string
): Promise<{ id: string; editUrl: string }> {
  const res = await fetch(`${API_BASE}/designs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'type_and_asset',
      design_type: { type: 'custom', width: size.width, height: size.height },
      title,
    }),
  });
  if (!res.ok) {
    console.error('[Canva] blank design creation failed:', res.status);
    throw new CanvaError('CANVA_CREATE_DESIGN_FAILED', 'Failed to create the Canva design');
  }
  const { design } = await res.json();
  if (!design?.id || !design?.urls?.edit_url) {
    console.error('[Canva] blank design response missing id/edit_url');
    throw new CanvaError('CANVA_CREATE_DESIGN_FAILED', 'Canva returned an unusable design');
  }
  return { id: design.id, editUrl: design.urls.edit_url };
}

export async function exportDesignAsPng(accessToken: string, designId: string): Promise<Buffer> {
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

  let downloadUrl: string;
  try {
    downloadUrl = await pollJob(`${API_BASE}/exports/${job.id}`, accessToken, (j) => j.urls?.[0]);
  } catch (err) {
    console.error('[Canva] export job failed:', err);
    throw new CanvaError('CANVA_EXPORT_FAILED', 'Canva could not finish exporting the design');
  }

  const imageRes = await fetch(downloadUrl);
  if (!imageRes.ok) throw new CanvaError('CANVA_EXPORT_FAILED', 'Failed to download the exported design');
  return Buffer.from(await imageRes.arrayBuffer());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Canva job JSON, shape varies by endpoint
async function pollJob<T>(url: string, accessToken: string, extract: (job: any) => T | undefined, { intervalMs = 1500, timeoutMs = 60000 } = {}): Promise<T> {
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

// --- Server-side session store ---
// Two short-lived handoffs, both single-use (consumed on read):
//  - pending: correlation_state -> designId, from "Edit in Canva" until the
//    user returns from the editor (verifies the return-navigation JWT's
//    design_id actually matches the design we created, not just any signed JWT).
//  - ready: readyId -> designId, from the return landing until the user
//    explicitly clicks "Import from Canva" (export only happens on that click,
//    never automatically on return).
// Flat JSON file, same pattern as scheduled-posts.json / linkedin-tokens.json.
// Fine for this app's single-instance/dev-scale deployment.

const SESSIONS_FILE = join(process.cwd(), 'canva-sessions.json');
const ONE_HOUR_MS = 60 * 60 * 1000;

interface CanvaSessions {
  pending: Record<string, { designId: string; createdAt: number }>;
  ready: Record<string, { designId: string; createdAt: number }>;
  // state -> code_verifier, for the /auth -> /callback PKCE round trip. Kept
  // server-side rather than in a cookie: cookies set right before redirecting
  // to a third party (Canva) and read back after Canva redirects to us don't
  // reliably survive that cross-site hop on every browser/privacy setting
  // (SameSite/ITP behavior varies, especially for IP-literal hosts like
  // 127.0.0.1) - a server-side nonce keyed by the state Canva echoes back
  // in the query string sidesteps that entirely.
  oauth: Record<string, { codeVerifier: string; createdAt: number }>;
}

function loadSessions(): CanvaSessions {
  if (!existsSync(SESSIONS_FILE)) return { pending: {}, ready: {}, oauth: {} };
  try {
    const parsed = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
    return { pending: parsed.pending || {}, ready: parsed.ready || {}, oauth: parsed.oauth || {} };
  } catch {
    return { pending: {}, ready: {}, oauth: {} };
  }
}

function saveSessions(sessions: CanvaSessions) {
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

function pruneExpired(sessions: CanvaSessions) {
  const now = Date.now();
  for (const map of [sessions.pending, sessions.ready]) {
    for (const [key, val] of Object.entries(map)) {
      if (now - val.createdAt > ONE_HOUR_MS) delete map[key];
    }
  }
  for (const [key, val] of Object.entries(sessions.oauth)) {
    if (now - val.createdAt > TEN_MINUTES_MS) delete sessions.oauth[key];
  }
}

export function savePkceVerifier(state: string, codeVerifier: string) {
  const sessions = loadSessions();
  pruneExpired(sessions);
  sessions.oauth[state] = { codeVerifier, createdAt: Date.now() };
  saveSessions(sessions);
}

// Consumes (deletes) the entry so a state/code can't be replayed.
export function takePkceVerifier(state: string): string | null {
  const sessions = loadSessions();
  const entry = sessions.oauth[state];
  if (!entry) return null;
  delete sessions.oauth[state];
  saveSessions(sessions);
  return entry.codeVerifier;
}

export function savePendingDesign(correlationState: string, designId: string) {
  const sessions = loadSessions();
  pruneExpired(sessions);
  sessions.pending[correlationState] = { designId, createdAt: Date.now() };
  saveSessions(sessions);
}

export function takePendingDesign(correlationState: string): string | null {
  const sessions = loadSessions();
  const entry = sessions.pending[correlationState];
  if (!entry) return null;
  delete sessions.pending[correlationState];
  saveSessions(sessions);
  return entry.designId;
}

// Fallback for return-navigation JWTs that verify but carry an empty
// correlation_state: consume the pending entry by verified design id.
export function takePendingDesignById(designId: string): string | null {
  if (!designId) return null;
  const sessions = loadSessions();
  const key = Object.keys(sessions.pending).find(k => sessions.pending[k]?.designId === designId);
  if (!key) return null;
  delete sessions.pending[key];
  saveSessions(sessions);
  return designId;
}

export function saveReadyDesign(readyId: string, designId: string) {
  const sessions = loadSessions();
  pruneExpired(sessions);
  sessions.ready[readyId] = { designId, createdAt: Date.now() };
  saveSessions(sessions);
}

export function takeReadyDesign(readyId: string): string | null {
  const sessions = loadSessions();
  const entry = sessions.ready[readyId];
  if (!entry) return null;
  delete sessions.ready[readyId];
  saveSessions(sessions);
  return entry.designId;
}
