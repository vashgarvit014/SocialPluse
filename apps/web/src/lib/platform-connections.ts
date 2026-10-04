import 'server-only';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';

// Per-user platform OAuth credentials.
//
// Replaces facebook-tokens.json and linkedin-tokens.json. Those files were
// keyed by the PROVIDER's member id and had no association with a SocialPulse
// account, which produced two distinct leaks:
//
//   1. `getAnyFacebookAuth()` / `getAnyLinkedInToken()` returned "the newest
//      entry in the vault" to whoever asked, so a newly signed-in user was
//      told they were connected to the previous user's LinkedIn/Page account.
//   2. `deleteFacebookAuth()` / `deleteLinkedInToken()` called with no argument
//      wiped the ENTIRE vault — reachable by any authenticated user.
//
// Everything here is therefore keyed on (user_id, platform). There is no
// "get any" function and no argument-optional delete, by design.
//
// `credentials` holds access/refresh tokens. It is read only to publish and is
// never serialised into a user-facing response or a log entry.

export type PlatformKey = 'facebook' | 'instagram' | 'linkedin' | 'canva';

export interface FacebookPageRecord {
  id: string;
  name: string;
  accessToken: string;
  instagramAccountId?: string;
  instagramUsername?: string;
}

export interface FacebookCredentials {
  userToken: string;
  pages: FacebookPageRecord[];
}

export interface LinkedInCredentials {
  accessToken: string;
}

export interface PlatformConnection {
  id: string;
  userId: string;
  platform: PlatformKey;
  providerUserId: string;
  displayName: string | null;
  email: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  platform: PlatformKey;
  provider_user_id: string;
  display_name: string | null;
  email: string | null;
  credentials: Record<string, unknown>;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toConnection(row: ConnectionRow): PlatformConnection {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    providerUserId: row.provider_user_id,
    displayName: row.display_name,
    email: row.email,
    meta: row.meta || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = 'id, user_id, platform, provider_user_id, display_name, email, credentials, meta, created_at, updated_at';

/**
 * Stores or refreshes a connection for a user.
 *
 * The unique index is on (platform, provider_user_id) across live rows, so a
 * provider account can belong to exactly one SocialPulse user. If the same
 * account is re-connected by a different user, the existing row is REASSIGNED
 * to the new owner: the alternative — letting two users point at one row —
 * would mean one user's tokens are readable through the other user's session.
 * Reassignment is the only safe resolution, and it is logged at the call site.
 */
export async function saveConnection(params: {
  userId: string;
  platform: PlatformKey;
  providerUserId: string;
  displayName?: string | null;
  email?: string | null;
  credentials: Record<string, unknown>;
  meta?: Record<string, unknown>;
}): Promise<PlatformConnection> {
  const now = new Date().toISOString();
  const rows = await query<ConnectionRow>(
    `INSERT INTO platform_connections
       (id, user_id, platform, provider_user_id, display_name, email, credentials, meta, created_at, updated_at, disconnected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NULL)
     ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     display_name = EXCLUDED.display_name,
                     email = EXCLUDED.email,
                     credentials = EXCLUDED.credentials,
                     meta = EXCLUDED.meta,
                     updated_at = EXCLUDED.updated_at
     RETURNING ${SELECT}`,
    [
      randomUUID(),
      params.userId,
      params.platform,
      params.providerUserId,
      params.displayName ?? null,
      params.email ?? null,
      JSON.stringify(params.credentials),
      JSON.stringify(params.meta ?? {}),
      now,
    ],
  );
  return toConnection(rows[0]);
}

/** Live connection for a user on a platform, or null. Always user-scoped. */
export async function getConnection(userId: string, platform: PlatformKey): Promise<(PlatformConnection & { credentials: Record<string, unknown> }) | null> {
  const rows = await query<ConnectionRow>(
    `SELECT ${SELECT} FROM platform_connections
      WHERE user_id = $1 AND platform = $2 AND disconnected_at IS NULL`,
    [userId, platform],
  );
  return rows[0] ? { ...toConnection(rows[0]), credentials: rows[0].credentials || {} } : null;
}

/** Every live connection for a user. */
export async function listConnections(userId: string): Promise<PlatformConnection[]> {
  const rows = await query<ConnectionRow>(
    `SELECT ${SELECT} FROM platform_connections WHERE user_id = $1 AND disconnected_at IS NULL ORDER BY platform`,
    [userId],
  );
  return rows.map(toConnection);
}

/**
 * Cross-user view for the Superadmin connections console only. Callers must be
 * behind requireApiSuperadmin(). Never used by a user-facing route.
 */
export async function listAllConnections(): Promise<(PlatformConnection & { email: string | null })[]> {
  const rows = await query<ConnectionRow>(
    `SELECT ${SELECT} FROM platform_connections WHERE disconnected_at IS NULL ORDER BY platform, created_at DESC`,
  );
  return rows.map(toConnection);
}

/**
 * Disconnects a user's platform connection. userId is REQUIRED and
 * non-optional: the previous signature accepted `undefined`, which meant
 * "delete every connection in the system".
 */
export async function disconnectPlatform(userId: string, platform: PlatformKey): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE platform_connections SET disconnected_at = $3, updated_at = $3
      WHERE user_id = $1 AND platform = $2 AND disconnected_at IS NULL RETURNING id`,
    [userId, platform, new Date().toISOString()],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------
// Credential resolvers. Each takes the owning userId from the server-side
// session (or a signed internal assertion) and never from client input.
// ---------------------------------------------------------------------

export async function getLinkedInCredentials(userId: string): Promise<LinkedInCredentials | null> {
  const conn = await getConnection(userId, 'linkedin');
  if (!conn) return null;
  const accessToken = typeof conn.credentials.accessToken === 'string' ? conn.credentials.accessToken : '';
  return accessToken ? { accessToken } : null;
}

/** Full Facebook entry for a user, minus the Page tokens. */
export async function getFacebookAuth(userId: string): Promise<{
  providerUserId: string;
  userToken: string;
  pages: Array<{ id: string; name: string; instagramAccountId?: string; instagramUsername?: string }>;
} | null> {
  const conn = await getConnection(userId, 'facebook');
  if (!conn) return null;
  const creds = conn.credentials as unknown as Partial<FacebookCredentials>;
  const pages = Array.isArray(creds.pages) ? creds.pages : [];
  if (pages.length === 0) return null;
  return {
    providerUserId: conn.providerUserId,
    userToken: typeof creds.userToken === 'string' ? creds.userToken : '',
    pages: pages.map(p => ({
      id: p.id,
      name: p.name,
      ...(p.instagramAccountId ? { instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername } : {}),
    })),
  };
}

/** Resolves the Page token to publish with, scoped to the owning user. */
export async function getFacebookPageToken(userId: string, pageId?: string): Promise<{ pageId: string; pageName: string; token: string } | null> {
  const conn = await getConnection(userId, 'facebook');
  if (!conn) return null;
  const pages = (conn.credentials as unknown as Partial<FacebookCredentials>).pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const page = (pageId && pages.find(p => p.id === pageId)) || pages[0];
  if (!page?.accessToken) return null;
  return { pageId: page.id, pageName: page.name, token: page.accessToken };
}

/**
 * Resolves the linked Instagram business account to publish with, using the
 * same Page access token (there is no separate Instagram token). Explicit
 * pageId picks a specific Page's linked IG account; otherwise the first Page
 * that HAS a linked IG account wins — a user can administer Pages with no IG
 * account attached.
 */
export async function getInstagramAccount(userId: string, pageId?: string): Promise<{ igUserId: string; username: string; pageId: string; pageName: string; token: string } | null> {
  const conn = await getConnection(userId, 'facebook');
  if (!conn) return null;
  const pages = (conn.credentials as unknown as Partial<FacebookCredentials>).pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const page = (pageId && pages.find(p => p.id === pageId)) || pages.find(p => p.instagramAccountId);
  if (!page?.instagramAccountId || !page.accessToken) return null;
  return {
    igUserId: page.instagramAccountId,
    username: page.instagramUsername || '',
    pageId: page.id,
    pageName: page.name,
    token: page.accessToken,
  };
}

/** Instagram account ids linked to a user's Pages — used to build publish links. */
export async function listInstagramAccounts(userId: string): Promise<Array<{ igUserId: string; username: string; pageId: string; pageName: string }>> {
  const auth = await getFacebookAuth(userId);
  if (!auth) return [];
  return auth.pages
    .filter(p => p.instagramAccountId)
    .map(p => ({ igUserId: p.instagramAccountId!, username: p.instagramUsername || '', pageId: p.id, pageName: p.name }));
}