import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Server-side OAuth token vault. Tokens never leave the server:
// the browser only ever holds { platform, userId, name, email }.
const VAULT_FILE = join(process.cwd(), 'linkedin-tokens.json');

interface VaultEntry {
  accessToken: string;
  updatedAt: string;
}

interface Vault {
  linkedin: Record<string, VaultEntry>;
}

function loadVault(): Vault {
  if (!existsSync(VAULT_FILE)) return { linkedin: {} };
  try {
    const raw = JSON.parse(readFileSync(VAULT_FILE, 'utf8')) as Partial<Vault>;
    if (!raw || typeof raw !== 'object' || !raw.linkedin || typeof raw.linkedin !== 'object') {
      return { linkedin: {} };
    }
    return { linkedin: raw.linkedin as Record<string, VaultEntry> };
  } catch {
    return { linkedin: {} };
  }
}

function saveVault(vault: Vault) {
  writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2));
}

export function storeLinkedInToken(userId: string, accessToken: string) {
  if (!userId || !accessToken) return;
  const vault = loadVault();
  vault.linkedin[userId] = { accessToken, updatedAt: new Date().toISOString() };
  saveVault(vault);
}

export function getLinkedInToken(userId: string): string | null {
  if (!userId) return null;
  const entry = loadVault().linkedin[userId];
  return entry?.accessToken || null;
}

export function deleteLinkedInToken(userId?: string) {  const vault = loadVault();
  if (userId) {
    delete vault.linkedin[userId];
  } else {
    vault.linkedin = {};
  }
  saveVault(vault);
}
