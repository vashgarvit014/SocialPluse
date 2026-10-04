import 'server-only';
import {
  disconnectPlatform,
  getFacebookAuth as readFacebookAuth,
  getFacebookPageToken as readFacebookPageToken,
  getInstagramAccount as readInstagramAccount,
  saveConnection,
  type FacebookPageRecord as FacebookPageEntry,
} from '@/lib/platform-connections';

// Server-side Facebook/Instagram OAuth vault.
//
// This used to read linkedin/facebook global JSON files keyed by the Meta
// profile id, with a getAnyFacebookAuth() fallback that handed the newest
// entry to any caller and a deleteFacebookAuth() that wiped everything when
// called without an argument. Both are gone: credentials now live in
// platform_connections, keyed by (user_id, platform), and every function here
// takes the OWNING SocialPulse userId — which route handlers derive from the
// server-side session, never from a request body or query string.
//
// Tokens never leave the server: the browser only ever holds
// { platform, userId, name, pages: [{id, name}], pageId }.
//
// Instagram rides on this same vault rather than having its own: a publishable
// Instagram account is a Business/Creator account linked to a Facebook Page,
// published to with that Page's own access token. Each Page entry optionally
// carries the linked IG business account id/username, captured at OAuth time.

export type { FacebookPageEntry };

export async function storeFacebookAuth(
  userId: string,
  providerUserId: string,
  userToken: string,
  pages: Array<{ id: string; name: string; accessToken: string; instagramAccountId?: string; instagramUsername?: string }>,
) {
  if (!userId || !providerUserId || !userToken) return;
  await saveConnection({
    userId,
    platform: 'facebook',
    providerUserId,
    displayName: pages[0]?.name ?? null,
    credentials: {
      userToken,
      pages: pages.map(p => ({
        id: p.id,
        name: p.name,
        accessToken: p.accessToken,
        ...(p.instagramAccountId ? { instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername } : {}),
      })),
    },
    meta: { pageCount: pages.length },
  });
}

/** Page token to publish with. userId is the owning account, from the session. */
export async function getFacebookPageToken(userId: string, pageId?: string) {
  return readFacebookPageToken(userId, pageId);
}

/** Linked Instagram business account to publish with, using the Page token. */
export async function getInstagramAccount(userId: string, pageId?: string) {
  return readInstagramAccount(userId, pageId);
}

/**
 * Live-verifies the stored Meta token and returns the Page list (never the
 * Page tokens). Scoped to the owning user — the previous "any connected
 * account" variant is intentionally not provided.
 */
export async function getFacebookAuth(userId: string) {
  return readFacebookAuth(userId);
}

/** Removes this user's Facebook connection. userId is required, never optional. */
export async function deleteFacebookAuth(userId: string): Promise<boolean> {
  return disconnectPlatform(userId, 'facebook');
}