# @socialpulse/ui — scaffold only

This package is a placeholder, created to match the repository's planned
target layout. It is **not wired into any build** and nothing imports it.

Intended future purpose: shared UI primitives/components currently
duplicated or living separately inside `apps/web` (the public product UI)
and `apps/superadmin` (the admin console UI). Extracting them into this
package is real, separate work — not done as part of the folder
restructure that created this stub.

**Also worth noting:** no genuine shared primitive was actually found
duplicated between the two apps' UI this round — `apps/web`'s own
components and `apps/superadmin`'s `ui.ts` display helpers serve visually
distinct surfaces with no byte-identical overlap (unlike `admin-client.ts`,
which was). And even if one were found, `apps/web`/`apps/superadmin`'s
per-app-scoped Docker build context (see `packages/api-client`'s README)
means a real cross-package import would need that build-context work
done first anyway.
