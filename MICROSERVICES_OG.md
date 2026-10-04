# SocialPulse Microservices Handoff

Updated on 2026-10-04 from branch `codex-next` by a full autonomous
verification/repair pass. Everything below was **observed at runtime**, not
inferred: every container, route, table and domain named here was checked
against the live stack.

## Baseline

- Trusted snapshot branch: `pullover_0.2`
- Current working branch: `codex-next`
- Do not modify remote `main`.
- `apps/web` is the normal frontend source tree; the runtime container is named `socialpulse` for compatibility.
- `apps/superadmin` is the independent Superadmin frontend; runtime container `socialpulse-superadmin-app`.
- Compose project name is pinned, so `-p` is never required.

## Runtime Architecture (verified)

Browser traffic enters a frontend app, which calls only its own `/api/*`
compatibility routes. Those routes proxy to the **gateway**, the single
controlled backend boundary. The gateway verifies the browser session via
auth-service and forwards trusted actor context plus a shared
`x-internal-secret` to downstream services. Browser-supplied `x-user-id`,
role, and internal identity headers are **not** trusted.

Verified trust boundary (25/25 assertions passed, run from inside the compose
network):

- no session -> 401 on `/api/auth/me`, `/api/media-assets`, `/api/scheduler`, `/api/admin/dashboard/summary`
- forged `x-user-id`, `x-user-role`, `x-role`, `x-actor-role`, `x-internal-user-id`, `x-internal-secret` -> still 401
- malformed/garbage/`alg:none` session cookies -> 401
- direct calls to auth/user/admin/media services **without** `x-internal-secret` -> 401
- direct calls with a **wrong** `x-internal-secret` -> 401
- `x-request-id` is echoed back end-to-end

Postgres is reachable **only** on the internal compose network — no host port
is published.

## Services And Ownership

- **gateway** — external/backend routing boundary, health, SUPERADMIN role gating.
- **auth-service** — signup, login, logout, session verify/revoke, OTP (request/verify/resend), password reset/change, Superadmin auth checks.
- **user-service** — profile/account state, moderation metadata, editor drafts.
- **ai-service** — AI generation, image variation, moderation, alt-text, AI usage.
- **media-service** — media asset persistence, upload/read/delete, branded video, expired-media cleanup (the only `setInterval` in any service).
- **integrations-service** — provider connection lifecycle and reads (Canva, LinkedIn, Facebook, Instagram, WhatsApp/Whapi).
- **publishing-service** — provider publishing execution + idempotency (LinkedIn, Facebook, Instagram, Whapi).
- **scheduler-service** — **sole** due-job executor and `scheduled_posts` owner; atomic claim via `FOR UPDATE SKIP LOCKED` + stale-lock reclaim; 15s worker.
- **analytics-service** — analytics reporting.
- **admin-service** — Superadmin reporting/action facade (audit logs, users, moderation, auth events, sessions, system health, publishing monitor, notifications).

### Scheduler uniqueness (verified)

`scheduled_posts` is written **only** by `scheduler-service/src/post-store.mjs`.
No other service or script mutates it. publishing-service has no timer, cron,
or due-post claim — its `claimAttempt()` is a request-driven idempotency
reservation. A duplicate non-atomic `claimDuePosts()` still exists as
**unreachable dead code** at `apps/web/src/lib/post-store.ts:247`; it must
never be re-wired (it has no `FOR UPDATE`).

## Frontend Apps

### apps/web

83 of 87 `route.ts` files are thin `proxyToGateway` / `callGateway`
proxies. The 4 non-proxy routes are benign (2 redirect shims, 1 OAuth-cookie
route, 1 `410` tombstone).

**Repaired this pass:** `app/superadmin/ai-usage/page.tsx` was a live server
component that imported `lib/ai-usage` -> `lib/db` (`pg`) and ran raw SQL on
`ai_usage_log`. That both violated the "frontend holds no backend logic" rule
*and* could never work, because the `socialpulse` container is deliberately
never given `DATABASE_URL`. It now reads through `callGateway` like every
sibling admin page and degrades to the empty state on any failure. (Note: the
gateway route exists but `admin-service` does not yet implement `/ai-usage`,
so the page shows its empty state — that is a missing feature, not a crash.)

**Repaired this pass:** removed the browser's 60s + `visibilitychange`
`POST /api/scheduler/check` poll. The gateway gates that route to SUPERADMIN,
so it was a guaranteed 403 every minute for every regular user while leaving a
client-controlled dispatch path into the sole executor. The SUPERADMIN-only
"Check now" button is untouched.

Known remaining: ~33 unreachable monolith modules still sit under
`apps/web/src/lib` (raw SQL on `users`/`otp_challenges`/`user_sessions`,
scrypt password hashing, OTP generation, nodemailer, Canva/Facebook/NVIDIA
calls). They are **not bundled and not shipped** (no entrypoint reaches them;
`pg` is server-only and no media *writer* survives), but they remain
type-checked by `next build`. Remove once historical imports are gone.

`apps/web/src/proxy.ts` statically imports the session helper, which pulls
`lib/db` into the middleware bundle. No query is ever executed (cookie-only
check, lazy pool) — capability, not a live call.

### apps/web — OTP

`OtpInput` stores per-box state and hands the parent only gap-free digits.
A flat string cannot represent a gap, which is what made verification silently
never fire. Both copies are byte-pinned by
`npm run test:shared-otp-input` (`infrastructure/scripts/verify-shared-otp-input.mjs`),
because `apps/superadmin` keeps its own copy — `packages/` is outside both
Docker build contexts, so a cross-package import cannot work until the
Dockerfiles build from the repo root.

### apps/superadmin

Verified clean: every one of its 33 entrypoints reaches only
`lib/gateway-client`, `lib/admin-client`, `lib/auth-proxy`, `lib/session`,
`lib/client-identity`, and validation schemas. Zero `pg`, zero SQL, zero
provider hosts, zero API keys.

## Docker Runtime

Frontend containers receive only frontend-safe config:
`apps/web` -> `NODE_ENV`, `PORT`, `HOSTNAME`, `NEXT_PUBLIC_APP_URL`,
`GATEWAY_URL`. `apps/superadmin` -> `PORT`, `GATEWAY_URL`. **No provider, DB,
or internal secret reaches either frontend**, at build time or runtime.
`NEXT_PUBLIC_APP_URL` is the only `NEXT_PUBLIC_*` variable in the repo and is
a public HTTPS URL — no secret carries that prefix.

All 15 containers healthy. 13 of 15 have healthchecks; the two
`cloudflared` tunnels have none by design (no HTTP endpoint to probe).

### Secret ownership note

`ai-service`, `auth-service`, and `admin-service` additionally declare
`env_file: .env.local`, which injects **all** of its keys — so each holds
secrets belonging to the others (blast radius, not a leak). Worth narrowing,
but it is pre-existing and changing it risks breaking a working deployment.

## Failure Isolation (verified)

Each service was stopped in turn, then restarted. In **all 9 cases** every
unrelated service stayed healthy, `GET /` on the web app stayed `200`, and
`gateway/health` stayed `200`; every service returned to `healthy` after
restart. Verified for: auth, user, media, ai, analytics, admin, integrations,
publishing, scheduler.

## Observability

Structured JSON on stdout, one object per line, with `service`, `level`,
`timestamp`, `requestId`, `path`, `method`, `status`, `durationMs`.

Scanned 24h of logs across all 12 app/service containers for leaks:
**0** OTP values, **0** session tokens, **0** passwords, **0** secret-shaped
strings.

## Legacy Files (classified — nothing deleted)

- `scheduled-posts.json` (~48 MB) — **live**, but only as a one-shot
  migration: read by `scheduler-service/src/post-store.mjs:27`, gated on the
  `data_migrations` row `legacy_posts_imported`, bind-mounted `:ro` to exactly
  one service. After that row exists it is never read again. Known risk: the
  read is a synchronous 48 MB `readFileSync` + `JSON.parse` on the request
  path, and a parse failure re-attempts it on every request until it succeeds.
- `facebook-tokens.json`, `linkedin-tokens.json` — read **only** by the
  explicit manual operator script `claim-legacy-connections.mjs`. Not mounted,
  not read by live app code. Superseded by `platform_connections`.
- `canva-sessions.json` — **completely unreferenced** (no code, no mount, no
  script). Canva handshakes are DB-backed. This is the file whose vanished
  bind-mount previously caused a production 502, so it was left in place
  deliberately rather than deleted during an automated pass.

## Compatibility Routes (intentionally retained)

- `/api/whapi/*` — `410 Gone` tombstone (`api/whapi/client.ts`).
- `/api/internal/scrub-post-accounts` — `410` tombstone; ownership moved to
  scheduler-service.
- `/api/instagram/auth`, `/api/instagram/callback` — redirect shims to the
  Facebook OAuth start.
- `/api/connect/[platform]` — redirect + httpOnly cookie shim.
- 83 `apps/web/src/app/api/**/route.ts` proxies — allowed temporarily as the
  single supported call path from the browser to the gateway.

None of these duplicate business logic.

## Verification Summary

Passed this pass:

- `apps/web` + `apps/superadmin` typecheck; `apps/web` production build
- `apps/superadmin` production build (Docker — its supported path)
- `docker compose config --quiet`; all containers healthy
- user isolation, HTTP + SQL level: **44/44** (cross-user media, scheduler,
  drafts, connections; retention scoping; storage-boundary traversal refusal)
- gateway trust boundary: **25/25**
- OTP regression (both component copies): **71/71**
- post-login redirect cannot be stranded by a leaked `__rsc` param
- failure isolation across 9 services
- log-leak scan clean
- both production domains serving the correct app

Known pre-existing debt, not repaired here (out of scope, high risk):
517 ESLint problems in `apps/web` (401 of them a single `react-hooks/refs`
rule, 426 of those in `_shell/studio-wizard.tsx`). `next build` passes;
these files were untouched by this pass.

## External Manual Validation Only

- real public LinkedIn / Facebook / Instagram / WhatsApp posts
- real OAuth consent completion (Canva/LinkedIn/Facebook) with real accounts
- real WhatsApp/Whapi message send to real users or groups
- AI provider live generation (benign prompts only until a sandbox key exists)

## Remaining Technical Debt

- Compatibility routes retained until proven unused.
- Dead monolith modules under `apps/web/src/lib` (see above).
- `admin-service` has no `/ai-usage` endpoint, so the Superadmin AI-usage
  page renders its empty state.
- `env_file: .env.local` over-broad on three services.
- WhatsApp webhook HMAC verification is fail-open
  (`integrations-service/providers/whatsapp/routes.mjs:130`: returns `true`
  when `WHATSAPP_APP_SECRET` is unset — which it currently is). Dormant in
  shared-Whapi mode, but it should fail closed.
- Shared `OtpInput` still duplicated across the two apps, enforced
  byte-equal rather than truly shared.
- The public production host and `localhost` both reach `apps/web`'s
  `/superadmin` tree in development; only production hosts 404 it.
