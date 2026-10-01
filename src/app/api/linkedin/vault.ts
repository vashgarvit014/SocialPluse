import 'server-only';
import {
  disconnectPlatform,
  getConnection,
  getLinkedInCredentials,
  saveConnection,
} from '@/lib/platform-connections';

// Server-side LinkedIn OAuth vault.
//
// Previously a global linkedin-tokens.json keyed by the LinkedIn `sub`, plus a
// getAnyLinkedInToken() fallback that returned the newest entry to any caller
// (so a freshly signed-in user was shown the previous user's connection) and a
// deleteLinkedInToken() that emptied the entire file when called without an
// argument. Credentials now live in platform_connections, keyed by
// (user_id, platform). There is no "any" lookup and no optional-argument
// delete here.
//
// Tokens never leave the server: the browser only ever holds
// { platform, userId, name, email }.

export async function storeLinkedInToken(userId: string, providerUserId: string, accessToken: string, meta?: { displayName?: string | null; email?: string | null }) {
  if (!userId || !providerUserId || !accessToken) return;
  await saveConnection({
    userId,
    platform: 'linkedin',
    providerUserId,
    displayName: meta?.displayName ?? null,
    email: meta?.email ?? null,
    credentials: { accessToken },
  });
}

/** userId is the OWNING SocialPulse account, from the server-side session. */
export async function getLinkedInToken(userId: string): Promise<string | null> {
  const creds = await getLinkedInCredentials(userId);
  return creds?.accessToken || null;
}

/**
 * Token plus the LinkedIn member id it belongs to, for the same user.
 *
 * These are two different identities and conflating them was the original
 * bug: the OAuth callback used to write `userId = profile.sub` (the LinkedIn
 * member id) while publish used a body-supplied value for the same field. The
 * `urn:li:person:...` author needs the PROVIDER id, but that value must come
 * from the connection row belonging to the session user — never from the
 * request.
 */
export async function getLinkedInAuth(userId: string): Promise<{ providerUserId: string; accessToken: string } | null> {
  const conn = await getConnection(userId, 'linkedin');
  if (!conn) return null;
  const creds = await getLinkedInCredentials(userId);
  if (!creds?.accessToken) return null;
  return { providerUserId: conn.providerUserId, accessToken: creds.accessToken };
}

/** Removes this user's LinkedIn connection. userId is required, never optional. */
export async function deleteLinkedInToken(userId: string): Promise<boolean> {
  return disconnectPlatform(userId, 'linkedin');
}