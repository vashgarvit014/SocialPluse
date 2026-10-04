# @socialpulse/validation — scaffold only

This package is a placeholder, created to match the repository's planned
target layout. It is **not wired into any build** and nothing imports it.

Intended future purpose: the password/OTP/email/mobile validation rules
currently duplicated verbatim between `apps/web`'s
`src/lib/auth/{schemas,password-rules,format-rules,mobile}.ts` and
`services/auth-service/src/{schemas,password-rules,format-rules,
mobile}.mjs` (kept byte-for-byte identical by hand since the auth-service
extraction) — a natural first candidate to actually move here. Building
this is real, separate work — not done as part of the folder restructure
that created this stub.

**Known constraint (discovered testing packages/api-client — see its own
README):** `apps/web` and `apps/superadmin` each build with Next's
`output: 'standalone'` inside a Docker image whose build context is
scoped to the app's own directory, not the repo root. A sibling package
like this one is outside that context, so a real import from either app
would fail at build time (`Module not found`) without first restructuring
both Dockerfiles to build from the repo root — a separate, deliberately
deferred change. `services/auth-service` (a plain Node/ESM service, not
a Next.js app) does NOT have this constraint and could genuinely import
from here today, same pattern as its existing `packages/logger`/
`packages/cookies` imports.
