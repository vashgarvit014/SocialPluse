// Scaffold only — not wired into any build. Intended future purpose: a
// typed client for calling the gateway/services, replacing the scattered
// fetch('/api/...') calls in apps/web and the per-file callAdminService()
// helper duplicated in apps/web/src/lib/admin-client.ts and
// apps/superadmin/src/lib/admin-client.ts.
export const SCAFFOLD = true;
