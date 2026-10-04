'use client';

// Client-side per-user state isolation.
//
// Before this module existed the app kept three unscoped browser stores that
// outlived a logout:
//
//   localStorage 'socialpulse-draft'    raw base64 media + captions + schedule
//   localStorage 'socialAccounts'      platform account names, emails, Page ids
//   localStorage 'socialDrafts'         orphaned legacy drafts
//   IndexedDB  'socialpulse-editor'     full editor snapshots (return handoffs)
//
// None were ever cleared. Anyone signing in on the same browser inherited all
// of them, which meant a brand-new user could be offered the previous user's
// draft for restore and could see the previous user's connected accounts.
//
// Two mechanisms fix that:
//
//   1. NAMESPACING. Every user-owned key is written as
//      `sp:u:<userId>:<name>`, so a key read can never resolve to another
//      account's data even before the purge runs.
//
//   2. PURGE ON IDENTITY CHANGE. On mount, and whenever the signed-in id
//      changes, remove every `sp:u:*` key that is not the current user's,
//      plus the legacy unscoped keys. Logging out wipes all of it.

const PREFIX = 'sp:u:';
const IDENTITY_KEY = 'sp:current-user';

/**
 * Keys that predate namespacing and are therefore ambiguous by construction:
 * they belong to whoever happened to use this browser last. Removed on first
 * load by any signed-in user.
 */
const LEGACY_KEYS = ['socialpulse-draft', 'socialAccounts', 'socialDrafts'];

/** Not user data — a UI preference, safe to keep across identities. */
const NON_USER_KEYS = ['sp_superadmin_theme'];

export function userScopedKey(userId: string, name: string): string {
  return `${PREFIX}${userId}:${name}`;
}

/** True for any key belonging to some user, current or not. */
function isUserScopedKey(key: string): boolean {
  return key.startsWith(PREFIX);
}

function currentUserId(): string | null {
  try {
    return localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
}

/**
 * Removes browser state that belongs to a different account than the one now
 * signed in. Called on mount and on identity change.
 *
 * Deliberately does NOT clear the current user's own keys: switching tabs or
 * reloading must not throw away someone's unsaved draft.
 */
export function purgeForeignUserState(userId: string | null): { removed: string[] } {
  const removed: string[] = [];
  if (typeof localStorage === 'undefined') return { removed };

  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage);
  } catch {
    return { removed };
  }

  const keep = userId ? `${PREFIX}${userId}:` : null;
  for (const key of keys) {
    if (!isUserScopedKey(key) && !LEGACY_KEYS.includes(key)) continue;
    // Keep this user's own namespaced data.
    if (keep && key.startsWith(keep)) continue;
    // Legacy unscoped keys have no owner we can verify, so they always go.
    try {
      localStorage.removeItem(key);
      removed.push(key);
    } catch { /* storage unavailable */ }
  }

  if (userId) {
    try {
      localStorage.setItem(IDENTITY_KEY, userId);
    } catch { /* storage unavailable */ }
  }
  return { removed };
}

/**
 * Full wipe, for logout. Removes every user's namespaced state, the legacy
 * keys, the identity marker, sessionStorage and the IndexedDB editor store.
 */
export async function clearAllUserState(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (isUserScopedKey(key) || LEGACY_KEYS.includes(key) || key === IDENTITY_KEY) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* storage unavailable */ }

  try {
    sessionStorage.clear();
  } catch { /* storage unavailable */ }

  await clearEditorReturnStore();
}

/** Empties the IndexedDB store that holds cross-origin return snapshots. */
export function clearEditorReturnStore(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve();
      const req = indexedDB.open('socialpulse-editor', 1);
      req.onsuccess = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains('returns')) return resolve();
          const tx = db.transaction('returns', 'readwrite');
          tx.objectStore('returns').clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Detects that the signed-in account changed underneath an open tab — e.g. a
 * Superadmin terminated the session and another user logged in on the same
 * browser. Returns true when the identity moved.
 */
export function identityChanged(newUserId: string | null): boolean {
  const previous = currentUserId();
  if (previous === newUserId) return false;
  purgeForeignUserState(newUserId);
  return previous !== null && previous !== newUserId;
}

export const CLIENT_IDENTITY = {
  prefix: PREFIX,
  legacyKeys: LEGACY_KEYS,
  nonUserKeys: NON_USER_KEYS,
} as const;