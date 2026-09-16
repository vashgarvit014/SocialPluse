import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Server-side Facebook OAuth vault. Tokens never leave the server: the
// browser only ever holds { platform, userId, name, pages: [{id, name}],
// pageId }. Same pattern as the LinkedIn vault.
//
// Instagram publishing rides on this same vault rather than having its own:
// a publishable Instagram account is a Business/Creator account linked to a
// Facebook Page, and it's published to using that Page's own access token
// (there is no separate Instagram token). So each Page entry optionally
// carries the linked IG business account id/username, captured at OAuth time.
const VAULT_FILE = join(process.cwd(), 'facebook-tokens.json');

export interface FacebookPageEntry {
  id: string;
  name: string;
  accessToken: string;
  updatedAt: string;
  instagramAccountId?: string;
  instagramUsername?: string;
}

interface VaultEntry {
  userToken: string;
  pages: FacebookPageEntry[];
  updatedAt: string;
}

interface Vault {
  facebook: Record<string, VaultEntry>;
}

function loadVault(): Vault {
  if (!existsSync(VAULT_FILE)) return { facebook: {} };
  try {
    const raw = JSON.parse(readFileSync(VAULT_FILE, 'utf8')) as Partial<Vault>;
    if (!raw || typeof raw !== 'object' || !raw.facebook || typeof raw.facebook !== 'object') {
      return { facebook: {} };
    }
    return { facebook: raw.facebook as Record<string, VaultEntry> };
  } catch {
    return { facebook: {} };
  }
}

function saveVault(vault: Vault) {
  writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2));
}

export function storeFacebookAuth(
  userId: string,
  userToken: string,
  pages: Array<{ id: string; name: string; accessToken: string; instagramAccountId?: string; instagramUsername?: string }>,
) {
  if (!userId || !userToken) return;
  const vault = loadVault();
  vault.facebook[userId] = {
    userToken,
    pages: pages.map(p => ({
      id: p.id,
      name: p.name,
      accessToken: p.accessToken,
      updatedAt: new Date().toISOString(),
      ...(p.instagramAccountId ? { instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername } : {}),
    })),
    updatedAt: new Date().toISOString(),
  };
  saveVault(vault);
}

// Resolves the Page token to publish with: explicit pageId when given,
// otherwise the first stored Page. Returns null when nothing is stored.
export function getFacebookPageToken(userId: string, pageId?: string): { pageId: string; pageName: string; token: string } | null {
  if (!userId) return null;
  const entry = loadVault().facebook[userId];
  if (!entry || !Array.isArray(entry.pages) || entry.pages.length === 0) return null;
  const page = (pageId && entry.pages.find(p => p.id === pageId)) || entry.pages[0];
  if (!page?.accessToken) return null;
  return { pageId: page.id, pageName: page.name, token: page.accessToken };
}

// Resolves the linked Instagram business account to publish with, using the
// same Page access token. Explicit pageId picks a specific Page's linked IG
// account; otherwise the first Page that HAS a linked IG account wins (not
// just the first Page overall - a user can administer Pages with no IG
// account attached). Returns null when nothing is stored or no Page has IG
// linked.
export function getInstagramAccount(userId: string, pageId?: string): { igUserId: string; username: string; pageId: string; pageName: string; token: string } | null {
  if (!userId) return null;
  const entry = loadVault().facebook[userId];
  if (!entry || !Array.isArray(entry.pages) || entry.pages.length === 0) return null;
  const page = (pageId && entry.pages.find(p => p.id === pageId)) || entry.pages.find(p => p.instagramAccountId);
  if (!page?.instagramAccountId || !page.accessToken) return null;
  return { igUserId: page.instagramAccountId, username: page.instagramUsername || '', pageId: page.id, pageName: page.name, token: page.accessToken };
}

// Full stored entry for a user (used by the status route to live-verify the
// user token and return the current Page list — never returns Page tokens).
export function getFacebookAuth(userId: string): { userToken: string; pages: Array<{ id: string; name: string; instagramAccountId?: string; instagramUsername?: string }> } | null {
  if (!userId) return null;
  const entry = loadVault().facebook[userId];
  if (!entry || !Array.isArray(entry.pages) || entry.pages.length === 0) return null;
  return {
    userToken: entry.userToken,
    pages: entry.pages.map(p => ({ id: p.id, name: p.name, instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername })),
  };
}

// Fallback lookup when the browser has no cached userId at all (e.g. OAuth
// completed in a different tab/origin than the one currently open, so
// nothing was ever written to this tab's localStorage). This is a
// single-user local tool, not multi-tenant, so "the one connected account"
// is a reasonable resolution — mirrors how Canva's status check needs no
// client-supplied id either (cookie-based). Picks the most recently updated
// entry if somehow more than one exists.
export function getAnyFacebookAuth(): { userId: string; userToken: string; pages: Array<{ id: string; name: string; instagramAccountId?: string; instagramUsername?: string }> } | null {
  const entries = Object.entries(loadVault().facebook);
  if (entries.length === 0) return null;
  const [userId, entry] = entries.sort((a, b) => (b[1].updatedAt || '').localeCompare(a[1].updatedAt || ''))[0];
  if (!entry || !Array.isArray(entry.pages) || entry.pages.length === 0) return null;
  return {
    userId,
    userToken: entry.userToken,
    pages: entry.pages.map(p => ({ id: p.id, name: p.name, instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername })),
  };
}

export function deleteFacebookAuth(userId?: string) {
  const vault = loadVault();
  if (userId) {
    delete vault.facebook[userId];
  } else {
    vault.facebook = {};
  }
  saveVault(vault);
}
