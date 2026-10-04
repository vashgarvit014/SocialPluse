# @socialpulse/api-client

`index.ts` is the real, de-duplicated implementation of
`callAdminService` — the one admin-service HTTP client every Superadmin
SSR page/API route in both `apps/web` and `apps/superadmin` uses (27 call
sites combined, confirmed byte-identical by diff before this extraction).

**Tested and reverted this round:** wiring both apps to actually import
from here (via a `file:../../packages/api-client` dependency +
`transpilePackages`) was tried for real, not just reasoned about. It
fails at build time: `Module not found`. Cause — both apps build with
Next's `output: 'standalone'` inside a Docker image whose **build context
is scoped to the app's own directory** (`context: ./apps/web` /
`./apps/superadmin` in `docker-compose.yml`), so `packages/api-client`,
a sibling directory one level up, is outside what Docker ever copies
into the build — `npm install` silently no-ops the unresolvable local
path, and the subsequent `next build` then genuinely can't find the
module.

The real fix is restructuring both Dockerfiles to build from the repo
root (`context: .`, explicit `COPY apps/web/... packages/... `), the same
pattern `services/*` already use successfully. That is itself a real,
Docker-context change to a live container's build pipeline, and was
judged too risky to make as a side effect of a shared-code extraction in
this round — it deserves its own tested pass.

**Until then**, `apps/web/src/lib/admin-client.ts` and
`apps/superadmin/src/lib/admin-client.ts` each keep their own working
copy of the same code, with a comment pointing back here as the
canonical source. Not a scaffold — real, deployed, working code — just
not yet actually shared at the dependency-resolution level.
