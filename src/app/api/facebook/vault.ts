import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Server-side Facebook OAuth vault. Tokens never leave the server: the
// browser only ever holds { platform, userId, name, pages: [{id, name}],
// pageId }. Same pattern as the LinkedIn vault.
const VAULT_FILE = join(process.cwd(), 'facebook-tokens.json');

export interface FacebookPageEntry {
  id: string;
  name: string;
  accessToken: string;
  updatedAt: string;
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

export function storeFacebookAuth(userId: string, userToken: string, pages: Array<{ id: string; name: string; accessToken: string }>) {
  if (!userId || !userToken) return;
  const vault = loadVault();
  vault.facebook[userId] = {
    userToken,
    pages: pages.map(p => ({ id: p.id, name: p.name, accessToken: p.accessToken, updatedAt: new Date().toISOString() })),
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

export function deleteFacebookAuth(userId?: string) {
  const vault = loadVault();
  if (userId) {
    delete vault.facebook[userId];
  } else {
    vault.facebook = {};
  }
  saveVault(vault);
}
