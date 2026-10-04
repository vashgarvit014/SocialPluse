import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { query } from '@/lib/db';

// User-bound OAuth handshake state.
//
// Previously the callbacks had no idea who started the flow: they stored the
// resulting token under the PROVIDER's member id into a global JSON vault,
// and relied on a cookie that `invalidReturnState()` treated as valid when it
// was simply ABSENT. So an attacker who obtained any authorization code could
// land a token in the shared vault, and the next user to hit /status was shown
// that connection as their own.
//
// Each flow now mints a cryptographically random state, persists the initiating
// SocialPulse userId against it, and consumes it exactly once on callback. The
// state row IS the binding — no session cookie needs to survive the provider
// round trip, and a callback with no matching state is rejected outright.

const STATE_TTL_MS = 30 * 60 * 1000; // matches the 30m editor-return cookie
const VALID_STATE = /^[A-Za-z0-9_-]{32,128}$/;

export function generateOAuthState(): string {
  // crypto CSPRNG, not Math.random(): this value is the only thing standing
  // between an attacker and completing someone else's OAuth flow.
  return randomBytes(32).toString('base64url');
}

export async function saveOAuthState(platform: string, userId: string, data: Record<string, unknown> = {}): Promise<string> {
  const state = generateOAuthState();
  await query(
    `INSERT INTO oauth_handshakes (id, user_id, platform, state_key, data, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomBytes(16).toString('hex').replace(/(.{8})(.{8})(.{8})(.{8})/, '$1-$2-$3-$4'),
      userId,
      platform,
      state,
      JSON.stringify(data),
      new Date().toISOString(),
      new Date(Date.now() + STATE_TTL_MS).toISOString(),
    ],
  );
  return state;
}

/**
 * Resolves a callback's state to the user who started the flow, and deletes
 * the row in the same statement so a state can never be replayed. Returns
 * null for an unknown, malformed or expired state — the caller must treat that
 * as a failed connection, never as "connect anyway".
 */
export async function consumeOAuthState<T = Record<string, unknown>>(
  platform: string,
  state: string | null,
): Promise<{ userId: string; data: T } | null> {
  if (!state || !VALID_STATE.test(state)) return null;
  const rows = await query<{ user_id: string; data: T }>(
    `DELETE FROM oauth_handshakes
      WHERE state_key = $1 AND platform = $2 AND expires_at > $3
      RETURNING user_id, data`,
    [state, platform, new Date().toISOString()],
  );
  const row = rows[0];
  if (!row) return null;
  return { userId: row.user_id, data: (row.data || {}) as T };
}

/** Constant-time compare for secrets we hand to a provider and read back. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Housekeeping: drops expired handshake rows. Cheap, and safe to call often. */
export async function pruneExpiredOAuthStates(): Promise<number> {
  const rows = await query<{ id: string }>(
    'DELETE FROM oauth_handshakes WHERE expires_at <= $1 RETURNING id',
    [new Date().toISOString()],
  );
  return rows.length;
}