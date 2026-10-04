# @socialpulse/api-client — scaffold only

This package is a placeholder, created to match the repository's planned
target layout. It is **not wired into any build** and nothing imports it.

Intended future purpose: a typed fetch client for calling the gateway and
individual services, replacing the scattered `fetch('/api/...')` calls in
`apps/web` and the small `callAdminService()` helper duplicated in both
`apps/web/src/lib/admin-client.ts` and
`apps/superadmin/src/lib/admin-client.ts`. Building this is real, separate
work — not done as part of the folder restructure that created this stub.
