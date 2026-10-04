import 'server-only';

// Phase 12 — the one server-side client every Superadmin SSR page/API
// route uses to reach admin-service. Deliberately contains NO SQL and NO
// direct DB/repository import: Superadmin pages must only ever go through
// this (or an equivalent call to auth-service/user-service), never
// straight to Postgres. See MIGRATION-NOTES.md for the full audit this
// replaces.
const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL || 'http://admin-service:4009';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

export type AdminServiceResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: null };

export async function callAdminService<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<AdminServiceResult<T>> {
  try {
    const res = await fetch(`${ADMIN_SERVICE_URL}${path}`, {
      method: init.method || 'GET',
      headers: {
        'x-internal-secret': INTERNAL_SECRET,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch {
    // admin-service unreachable — never throw out of an SSR render or an
    // API route; every caller gets a clean "unavailable" result instead.
    return { ok: false, status: 0, data: null };
  }
}
