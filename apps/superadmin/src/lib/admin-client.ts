import 'server-only';
import { callGateway } from './gateway-client';

// Phase 12 — the one server-side client every Superadmin SSR page/API
// route uses to reach admin-service. Deliberately contains NO SQL and NO
// direct DB/repository import: Superadmin pages must only ever go through
// this (or an equivalent call to auth-service/user-service), never
// straight to Postgres. See MIGRATION-NOTES.md for the full audit this
// replaces.
//
// Byte-identical to apps/web/src/lib/admin-client.ts and to
// packages/api-client/index.ts (the documented canonical source) — see
// that package's README for why this stays a real local copy rather than
// an import: Next.js's per-app standalone Docker build (build context
// scoped to apps/superadmin, not the repo root) cannot resolve a `file:`
// dependency pointing outside that context without a bigger Dockerfile/
// build-context restructuring, which this round judged too risky to do
// on a live container without its own dedicated, tested pass.
export type AdminServiceResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: null };

export async function callAdminService<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<AdminServiceResult<T>> {
  return callGateway<T>(`/api/admin${path}`, init);
}
