import 'server-only';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';

// User-scoped Canva handoffs, stored in the oauth_handshakes table.
//
// This replaces canva-sessions.json, whose three maps were keyed by
// `state` / `correlation_state` / `readyId` with NO owner field. That meant any
// user who obtained a readyId — for example from a shared browser, or from a
// canva-return landing URL — could import and export another user's Canva
// design through /api/canva/export.
//
// Every function here requires the acting userId and filters on it, so a
// lookup key is only ever meaningful together with the account that created
// it. All entries are single-use and TTL'd.

const ONE_HOUR_MS = 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const PLATFORM = 'canva';

function uuid(): string {
  return randomUUID();
}

async function put(userId: string, key: string, data: Record<string, unknown>, ttlMs: number): Promise<void> {
  const now = new Date();
  await query(
    `INSERT INTO oauth_handshakes (id, user_id, platform, state_key, data, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uuid(), userId, PLATFORM, key, JSON.stringify(data), now.toISOString(), new Date(now.getTime() + ttlMs).toISOString()],
  );
}

/** Consumes (deletes) the row so a key can't be replayed. Scoped to userId. */
async function take<T>(userId: string, key: string): Promise<T | null> {
  if (!key) return null;
  const rows = await query<{ data: T }>(
    `DELETE FROM oauth_handshakes
      WHERE user_id = $1 AND platform = $2 AND state_key = $3 AND expires_at > $4
      RETURNING data`,
    [userId, PLATFORM, key, new Date().toISOString()],
  );
  return rows[0]?.data ?? null;
}

/** Non-consuming read: used to verify a key BEFORE a slow export runs. */
async function peek<T>(userId: string, key: string): Promise<T | null> {
  if (!key) return null;
  const rows = await query<{ data: T }>(
    `SELECT data FROM oauth_handshakes
      WHERE user_id = $1 AND platform = $2 AND state_key = $3 AND expires_at > $4`,
    [userId, PLATFORM, key, new Date().toISOString()],
  );
  return rows[0]?.data ?? null;
}

// state -> code_verifier, for the /auth -> /callback PKCE round trip. Kept
// server-side rather than in a cookie: cookies set right before redirecting to
// a third party and read back after Canva redirects to us don't reliably
// survive that cross-site hop on every browser/privacy setting. A server-side
// nonce keyed by the state Canva echoes back sidesteps that — and now also
// records which user started the flow.
export async function savePkceVerifier(userId: string, state: string, codeVerifier: string) {
  await put(userId, `pkce:${state}`, { codeVerifier }, TEN_MINUTES_MS);
}

/**
 * Consumes the verifier row and returns the OWNING user alongside it.
 *
 * The callback has no session cookie to fall back on (Canva's redirect is a
 * third-party top-level navigation), so this lookup is the only thing that
 * identifies whose Canva connection is being created. It must therefore run
 * BEFORE the token exchange, while the row still exists.
 */
export async function takePkceVerifierUser(state: string): Promise<{ userId: string; data: { codeVerifier?: string } } | null> {
  if (!state) return null;
  const rows = await query<{ user_id: string; data: { codeVerifier?: string } }>(
    `DELETE FROM oauth_handshakes
      WHERE platform = $1 AND state_key = $2 AND expires_at > $3
      RETURNING user_id, data`,
    [PLATFORM, `pkce:${state}`, new Date().toISOString()],
  );
  const row = rows[0];
  return row ? { userId: row.user_id, data: row.data || {} } : null;
}

export async function takePkceVerifier(userId: string, state: string): Promise<string | null> {
  const entry = await take<{ codeVerifier?: string }>(userId, `pkce:${state}`);
  return entry?.codeVerifier ?? null;
}

export async function savePendingDesign(userId: string, correlationState: string, designId: string) {
  await put(userId, `pending:${correlationState}`, { designId }, ONE_HOUR_MS);
}

export async function takePendingDesign(userId: string, correlationState: string): Promise<string | null> {
  const entry = await take<{ designId?: string }>(userId, `pending:${correlationState}`);
  return entry?.designId ?? null;
}

/**
 * Fallback for return-navigation JWTs that verify but carry an empty
 * correlation_state: consume the pending entry by verified design id, still
 * scoped to this user.
 */
export async function takePendingDesignById(userId: string, designId: string): Promise<string | null> {
  if (!designId) return null;
  const rows = await query<{ state_key: string }>(
    `DELETE FROM oauth_handshakes
      WHERE user_id = $1 AND platform = $2 AND state_key LIKE 'pending:%'
        AND data->>'designId' = $3 AND expires_at > $4
      RETURNING state_key`,
    [userId, PLATFORM, designId, new Date().toISOString()],
  );
  return rows.length > 0 ? designId : null;
}

export async function saveReadyDesign(userId: string, readyId: string, designId: string) {
  await put(userId, `ready:${readyId}`, { designId }, ONE_HOUR_MS);
}

export async function takeReadyDesign(userId: string, readyId: string): Promise<string | null> {
  const entry = await take<{ designId?: string }>(userId, `ready:${readyId}`);
  return entry?.designId ?? null;
}

/**
 * Lets /api/canva/export verify the readyId BEFORE the (slow, fallible) export
 * runs, and only consume it after the export succeeds — so a failed import
 * keeps its readyId and "Retry Import" still works.
 */
export async function peekReadyDesign(userId: string, readyId: string): Promise<string | null> {
  const entry = await peek<{ designId?: string }>(userId, `ready:${readyId}`);
  return entry?.designId ?? null;
}