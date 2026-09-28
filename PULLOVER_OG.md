# PULLOVER - SocialPulse live tunnel + model state

Updated: 2026-09-28, built a full Superadmin management layer (role-based access, user management, and a 10-section dashboard reskinned from a supplied design reference) on top of the existing auth/OTP/PostgreSQL system. Live and deployed on `socialpulse.dotstark.tech`, entirely uncommitted. See CURRENT HANDOVER below.

## CURRENT HANDOVER — authoritative; supersedes historical sections below

### Latest implementation handover (2026-09-26/28 — Superadmin management layer + full dashboard reskin — all uncommitted)

Three linked requests across this window: (1) add a minimal SUPERADMIN role on top of the existing auth system (Users/System Health/Auth Activity/Settings, explicitly told "do not overbuild it" and "no ADMIN/MANAGER hierarchy"); (2) the user supplied a downloaded Claude workshop-artifact export (`~/Downloads/socialpulse-superadmin.html`) as a design reference and asked to reskin the dashboard to match it — scoped down (per an AskUserQuestion) to only the 4 sections with real backing data, dropping Active Sessions/Connections/AI Usage/Publishing Monitor rather than fabricate them; (3) the user then explicitly asked for those 4 dropped sections too ("i want them also"), which turned into real new backend work — a session-tracking table, AI usage metering, and a publishing-monitor reader — not just more UI.

**Role model (`src/lib/db.ts`, `src/lib/auth/users.ts`):** additive migration — `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'` (+ CHECK constraint `IN ('SUPERADMIN','USER')`), `last_login_at`, `must_set_password`. Every pre-existing row defaults to `USER` — nobody becomes Superadmin from a schema change. `role` is deliberately **never** embedded in the session JWT (`session.ts#SessionPayload` still only carries `userId`/`sessionVersion`/now `sessionId` — see below) — `dal.ts#verifySession()` always re-reads the user's role fresh from Postgres, so revoking Superadmin takes effect on that user's very next request, not after token expiry. `src/lib/auth/roles.ts` — `requireSuperadmin()` (Server Components/layouts, redirects) and `requireApiSuperadmin()` (Route Handlers, 401 unauthenticated / 403 wrong-role, never conflated) are the only two authorization helpers; every one of the ~15 `/api/superadmin/*` routes calls one of them first, no route trusts a hidden sidebar or disabled button.

**First Superadmin — seed script, not a UI (`scripts/create-superadmin.mjs`):** explicit instruction was "no Sign up as Superadmin," "do NOT hardcode credentials." First draft imported the repo's `.ts` validation helpers directly — caught before running it, since plain `node` can't execute TypeScript without a loader this project doesn't have. Rewrote to duplicate the small pure functions (`isValidName`, `isValidEmailFormat`, `isValidMobile`/`normalizeMobile`, `isPasswordValid`) inline with comments cross-referencing their real source, same pattern already used for `hashPassword()` (scrypt) in the same file — the only file in the project allowed to duplicate auth logic like this. Self-sufficient: duplicates just the `users` table migration too, so it works even against a totally fresh DB before the app has ever run. Run via `npm run create-superadmin` locally, or `docker compose run --rm -v "$(pwd)/scripts:/app/scripts:ro" socialpulse node scripts/create-superadmin.mjs` against the real Postgres container without ever publishing its port. Live account created this session: **`dev.dotstark@gmail.com` / `SocialPulse@2026!`**, display name "Garvit" (per explicit user request to rename it) — this password is now in chat history, user was told to rotate it via a normal self-service password reset once done testing.

**Admin-created user activation — reuses the existing Forgot-Password OTP path, no new mechanism:** the spec's "Create User" flow (Name/Email/Mobile → OTP → ACTIVE) has no password step, but normal login always needs password-then-OTP. Solved by `createAdminManagedUser()` giving the row a cryptographically random, never-exposed password hash (`must_set_password: true`), so normal login is impossible; the user instead uses the existing password-less Forgot Password entry point to prove ownership. This required one real fix: `password/forgot/route.ts` originally rejected any `status !== 'ACTIVE'` account — which silently broke this exact path for PENDING admin-created accounts. Changed the guard to only exclude `SUSPENDED`; `otp/verify/route.ts`'s `PASSWORD_RESET` branch already called `markChannelVerified()`, which is what actually flips PENDING→ACTIVE the moment the OTP succeeds. Found and fixed live during localhost testing, not theorized.

**Suspend/reactivate needs zero extra revocation code:** `dal.ts#verifySession()` already rejected any session where `user.status !== 'ACTIVE'` — so `setUserStatus(userId, 'SUSPENDED')` (a plain UPDATE) alone kills every active session on that user's very next request. `setUserStatus()` only allows ACTIVE↔SUSPENDED, explicitly rejecting PENDING with a clear message (spec's own state diagram) and no-op'ing a same-state transition.

**Reskin — decoded, not ported, from the supplied design (bundled Claude workshop artifact, ~112KB of a custom `x-dc`/`DCLogic` templating DSL, not React):** extracted via `json.loads()` on its `script[type="__bundler/template"]` block (same recovery technique as the 2026-09-23 `/welcome` landing page handover below), read its CSS custom-property theme (`[data-theme]` light/dark tokens, Plus Jakarta Sans + JetBrains Mono, `#0d0f2b` navy sidebar / `#6b5cf6` purple accent), its avatar-palette/relative-time/status-tone helper functions, and its per-section layout (stat tiles, sticky-action tables, filter bars) — then hand-wrote matching real Next.js Server/Client Components (`src/app/superadmin/ui.ts` for the shared helpers, `theme.css` scoped under `[data-superadmin]` so it never leaks into the rest of the app's own `#0f172a`/`#7C3AED` palette, `shell.tsx` for the collapsible/theme-toggleable sidebar) wired to real data — never the artifact's literal markup/DSL, which has no meaning outside its own runtime. The artifact's "Sample preview vs. Live API" toggle data was fabricated demo content (fake users like "Zara Ali," fake OAuth errors) — flagged to the user as such before building anything, since the original spec explicitly forbade fabricated analytics.

**All 10 of the reference's sections are now live with real data — the 4 that already existed, then the 5 more the user asked for after seeing the gap:**
- **Dashboard / Users / System Health / Auth Activity / Settings** — real DB-backed, as in the original (simpler) Superadmin build; Users gained status tabs (All/Active/Pending/Suspended with live counts) and Auth Activity gained event-type + channel filters this round.
- **Active Sessions (new)** — real architecture addition, kept strictly additive: new `user_sessions` table (id, user_id, user_agent, ip, created_at, last_seen_at, revoked_at), `session.ts#createSession()` now also inserts a row and embeds its id as an optional `sessionId` JWT claim, `dal.ts#verifySession()` does one extra indexed lookup (combined revocation-check + throttled last-seen touch in a single query) **only when a sessionId claim is present** — a JWT issued before this shipped has no claim and is still trusted (grandfathered), so this didn't invalidate anyone's existing login. `DELETE /api/superadmin/sessions/[id]` revokes a specific session; tested live by opening a second session with a distinct User-Agent, terminating it via the API, and confirming it was immediately 401'd on its next request.
- **Connections (new)** — reframed as **system-wide, not per-user**: SocialPulse has exactly one shared platform connection per tool (confirmed by reading the Facebook/LinkedIn vault modules' own comments — "single-user local tool, not multi-tenant"), so a per-user view would be fabricated. Reads the same on-disk vaults the app already publishes through (no live provider API calls, same discipline as System Health). Canva is honestly marked "Not trackable" — its tokens live only in the connecting browser's `httpOnly` cookies, never persisted server-side, so Superadmin structurally cannot know its status.
- **Publishing Monitor (new)** — reads `scheduled-posts.json` directly (`src/lib/publishing-monitor.ts`); confirmed via inspection that posts have no `userId` field at all (this app has always been single-tenant for content), so the "user" column from the reference was dropped rather than faked. Retry/Move-to-Draft are new narrow transitions (`retryFailedPost`/`moveFailedPostToDraft`) — **not** a reuse of `lib/posts.ts#reschedulePost`/`cancelPost`, since both of those explicitly guard against a `failed` status. Tested against a synthetic post injected into a backed-up copy of the real file, verified, then the real file was restored byte-for-byte — the 2 real failed posts already in production were never touched by testing.
- **AI & Usage (new)** — new `ai_usage_log` table + `src/lib/ai-usage.ts`, instrumented into `generate-content/route.ts` and `generate-image/route.ts`. Content generation's provider label is deliberately coarse (`'text-generation'`) rather than the specific model that won the internal Mercury/Nemotron race — threading that through `generateContent()`'s existing branching logic wasn't worth the risk of touching a large, working function for a usage-count metric; success/failure and timing are still exact. Image generation's single `PRIMARY_MODEL` constant made per-provider attribution safe to add directly. Starts counting from zero — nothing backfilled, no fabricated history; the page says so explicitly when the table is empty.
- **Audit Logs (new)** — no new storage; same `auth_audit_logs` table as Auth Activity, filtered to only Superadmin-initiated events (`ACCOUNT_SUSPENDED/REACTIVATED`, `USER_CREATED_BY_ADMIN`, `RESET_ACCESS_TRIGGERED`, and two new ones added this round, `SESSION_TERMINATED`/`PUBLISH_RETRIED`/`PUBLISH_MOVED_TO_DRAFT`) rather than login/OTP events. Caught and fixed a real mislabeling bug before it shipped: the sessions-terminate and publishing-retry routes were originally (accidentally) logging under `LOGOUT` and `USER_CREATED_BY_ADMIN` respectively — added the three correctly-named event types instead of leaving the audit trail lying about what happened.

**Verified end-to-end against the live Docker stack, not just `tsc`/`eslint`/`next build` (all also clean):** rebuilt + restarted the `socialpulse` container after every batch of changes; logged in as the real Superadmin account through the actual OTP flow (password → real `/api/auth/otp/request` → HMAC-injected known code via direct DB write, matching the project's established test pattern → `/api/auth/otp/verify` → confirmed `redirect:"/superadmin"`); created a real PENDING user through the Superadmin UI, activated it through the real Forgot-Password OTP path, confirmed it lands on `/dashboard` and gets 403/redirected from every `/superadmin/*` route and API; confirmed unauthenticated requests get 401 everywhere; confirmed tampering (`role: "SUPERADMIN"` in both the public signup body and the Superadmin's own create-user body) is silently ignored server-side both times; confirmed suspend kills an active session immediately and reactivate restores login; confirmed session termination, publish retry/draft, and AI-usage stats all work via real API calls against real (or carefully synthetic, cleaned-up) data. All test accounts, sessions, and injected rows were deleted afterward — confirmed via direct `psql` that the DB was left with only the 2 real accounts (`dev.dotstark@gmail.com` Superadmin, and a real `garvitvashishtha6097@gmail.com` USER account that appeared from the user's own testing, not touched).

**Two operational notes from this session, for whoever resumes:** (1) heavy repeated login testing against the Superadmin account exhausted its own rate-limit counter (`login:identifier:dev.dotstark@gmail.com`, 10/hour) mid-session, surfacing as a confusing "Invalid email/mobile or password" then "Too many login attempts" for the real user — cleared via `DELETE FROM rate_limit_counters WHERE key = '...'`; if this happens again, check that table before assuming credentials are wrong. (2) A cleanup pass ran `UPDATE user_sessions SET revoked_at = now() WHERE revoked_at IS NULL` to close out test sessions — this is broad and will log out **any** currently-open browser session including a real one; scope any future cleanup to specific session ids instead.

**Uncommitted at end of this session:** all of the above — `src/app/superadmin/**`, `src/app/api/superadmin/**`, `src/lib/auth/roles.ts`, `src/lib/auth/user-sessions.ts`, `src/lib/auth/connections.ts`, `src/lib/ai-usage.ts`, `src/lib/publishing-monitor.ts`, `scripts/create-superadmin.mjs`, plus edits to `src/lib/db.ts`, `src/lib/auth/users.ts`, `src/lib/auth/session.ts`, `src/lib/auth/dal.ts`, `src/lib/auth/audit.ts`, `src/proxy.ts`, `src/app/api/auth/otp/verify/route.ts`, `src/app/api/auth/password/forgot/route.ts`, `src/app/api/generate-content/route.ts`, `src/app/api/generate-image/route.ts`, `package.json`. Not committed — only asked to build/test/deploy and update this handover.

### Latest implementation handover (2026-09-24/25 — full auth + OTP system, then SQLite→PostgreSQL migration — all uncommitted)

Large multi-part session across several user requests: (1) build authentication from scratch — the app had none before this; (2) add OTP-based 2FA on top of it; (3) strengthen input validation; (4) migrate the auth DB from SQLite to a proper second PostgreSQL container. All four landed in the same uncommitted working tree; nothing before this handover touched auth at all (there was no login, no users table, no session concept — `/` was the app itself, no route protection).

**Routing restructure (foundational, done first):** the app previously lived entirely at `/`, with `/welcome` as a separate marketing page (see the superseded entry below). Moved the real app's 4000-line `SocialMediaManager` component and its ~10 sibling files (`studio-wizard.tsx`, `studio-workspace.tsx`, the four platform preview components, `scheduler-calendar.tsx`, `connect-platforms.tsx`, `post-preview.tsx`, `ai-image-loader.tsx`) into `src/app/_shell/`, then created six thin route pages (`/dashboard`, `/content-studio`, `/scheduler`, `/analytics`, `/connect-platforms`, `/asset-gallery`) that each render the shell with a different `initialTab`. `/welcome`'s landing page moved to `/` (the old app-at-`/` is gone; `/welcome` now just redirects to `/`). In-app tab switches use `history.pushState` (not Next's router) so the URL tracks the visible tab without remounting the 4000-line component and losing in-progress editor state — the existing draft-autosave-to-localStorage behavior made this safe. `/content-studio`'s `?correlation_jwt=` Canva return-URL relay (previously a `route.ts`) got folded into the new `page.tsx` so Canva's registered Return URL keeps working unchanged.

**Auth core (`src/lib/auth/`, `src/proxy.ts`):** Next.js 16 renamed `middleware.ts`→`proxy.ts` (same behavior) — read the bundled docs at `node_modules/next/dist/docs/` per this repo's `AGENTS.md` before writing it, since this wasn't obvious from training data. `proxy.ts` does an optimistic cookie-only check (no DB hit) to gate the six app routes + bounce authenticated users away from `/login-signup`; `src/lib/auth/dal.ts#verifySession()` is the real, DB-backed check every API route and Server Component actually trusts. Sessions are stateless HS256 JWT cookies (`jose`), `httpOnly`/`sameSite:lax`/`secure` in prod, holding `userId` + `sessionVersion` — password reset bumps `sessionVersion`, which is what makes "invalidate other sessions" actually invalidate them with no server-side session store. Passwords: scrypt (Node built-in, OWASP-listed Argon2id alternative avoiding a native dependency), never Math.random anywhere.

**OTP engine (`src/lib/auth/otp.ts`), reusable across purposes:** `purpose` field (`SIGNUP_VERIFY`/`LOGIN_VERIFY`/`PASSWORD_RESET`, room for `EMAIL_CHANGE`/`MOBILE_CHANGE` later) means one engine, not one per flow. 6-digit, `crypto.randomInt` (never `Math.random`), HMAC-SHA256 hash keyed by a secret separate from `SESSION_SECRET` (`OTP_HASH_SECRET` — rotating it only voids in-flight codes, not every session) and bound to the challenge id so the same digits hash differently across challenges. 5-minute expiry, 5 max attempts, 60s resend cooldown, 5 max resends, single-use (verify invalidates immediately), and — added this session after noticing it was missing — starting a fresh challenge for the same user+purpose now invalidates whatever challenge came before it (switching delivery channel, or double-clicking "send code", no longer leaves two simultaneously-valid codes). A short-lived separate `pending-auth` cookie (`src/lib/auth/pending-auth.ts`) carries "password just checked, OTP still owed" between login/signup and `/api/auth/otp/verify` — a real session is never created before OTP succeeds, checked live by curling `/dashboard` mid-flow and confirming 401/redirect.

**Delivery adapters, explicitly kept separate from existing integrations:** `src/lib/auth/delivery/email.ts` (SMTP via `nodemailer`) and `whatsapp-otp.ts` (Meta WhatsApp Cloud API) behind one `deliverOtp()` switch — auth code never touches SMTP/Meta details directly. WhatsApp OTP is deliberately a different code path from both the existing Whapi group-publishing integration (`src/app/api/whapi/*`) and the existing Meta group-messaging integration (`src/app/api/whatsapp/*`) — new `META_WHATSAPP_*` env vars, not reused. The one exception, made knowingly on explicit user instruction after I flagged it: `META_WHATSAPP_PHONE_NUMBER_ID`/`ACCESS_TOKEN` do share the same underlying Meta phone number as the existing group-publishing config (this account only has the one number) — accepted tradeoff is shared rate limits/reputation between OTP and group sends, documented inline in `.env.local`.

**Email delivery provider odyssey — three providers tried before landing on one that actually works, useful context if this breaks again:** Gmail SMTP first (`dev.dotstark@gmail.com` + app password) — worked initially, then silently hit Gmail's ~500/day sending cap mid-session (`550-5.4.5 Daily user sending limit exceeded`) purely from my own repeated verification test-sends, not anything the user did. Switched to Resend — worked, but its unverified sandbox sender only delivers to the Resend account's own registered email, rejecting any other recipient (`550 You can only send testing emails to your own email address`), useless for real signups. Switched to Mailjet (user-supplied API/secret keys) — SMTP accepted every send (`250 OK queued as ...`) but nothing arrived anywhere, not even Mailjet's own dashboard message log, for a stretch that looked exactly like a silent new-account compliance hold; verified a domain (`dotstark.tech`) for SPF+DKIM (walked the user through adding TXT records in Cloudflare DNS, `dig`-verified each one before letting Mailjet re-check) and separately had to activate the `*@dotstark.tech` sender via Mailjet's REST API (`POST /v3/REST/sender/{id}/validate` — the SPF/DKIM domain check and the individual sender's Active/Inactive status are two different gates, easy to satisfy one and still have delivery silently vanish because of the other) before mail actually started landing — confirmed via direct IMAP search against the recipient inbox, not just "the API returned 200." **Current known caveat:** delivery now works but new sends still land in Spam, not Inbox — expected for a domain with zero sending history; will self-resolve as `otp@dotstark.tech` builds reputation, no further action needed unless it persists.

**Input validation (`src/lib/auth/schemas.ts` + `format-rules.ts` + `password-rules.ts`, using `zod`):** one schema per field/route, imported by both the client (live on-blur validation + a real-time password requirement checklist) and every server route (`safeParse` → `{error:"VALIDATION_ERROR", fields:{...}}` on failure) — never two copies of "what's a valid email" that could drift apart. Password: 8-128 chars, upper+lower+digit+special, all four enforced identically client and server. Login intentionally validates only *format*, not complexity, and its identifier-vs-password errors are folded into one generic 401 message regardless of which part was actually wrong — deliberate, not an oversight (avoids account enumeration).

**Two real bugs found live via user screenshots and fixed, not just theorized:** (1) mixing a shorthand `border` (base style) with a longhand `borderColor`-only override (error state) in the same input's inline style caused React's style-diffing to throw *"Removing a style property during rerender (borderColor) when a conflicting property is set (border)"* — which Next 16's dev overlay escalates to a full-page blocking error, making the entire signup form look broken/dead. Fixed by using non-shorthand `borderWidth`/`borderStyle`/`borderColor` everywhere in `auth-client.tsx`. (2) The Continue/Reset-Password submit buttons could get permanently stuck disabled after browser/password-manager autofill — Chrome sometimes fills the visible input without firing React's `onChange`, so the component's live-computed "is this valid" state stayed stuck at `""` while the field visibly looked filled, with no error and no way to recover short of retyping. Removed that redundant client-side gate entirely (the real validation already runs and shows inline errors the moment Continue is actually clicked); reproduced the exact desync via Playwright (`nativeInputValueSetter` without dispatching events) to confirm the fix before calling it done, not just patched-and-hoped.

**PostgreSQL migration (`src/lib/db.ts` rewritten, `docker-compose.yml` gets a second service):** auth storage had already gone through SQLite (`better-sqlite3`, hit a Docker-target segfault on this arm64 host — see git history) → Node's built-in `node:sqlite` (worked, zero native deps) before this session; this session moved it again, to PostgreSQL running as its own container (`db`/`socialpulse-db`, `postgres:16`, named volume `postgres_data`, **no published port** — confirmed unreachable from the host via `nc -zv localhost 5432` → connection refused). `pg` (node-postgres) is the client — no ORM existed before, `pg` is the minimal standard choice matching this codebase's existing raw-SQL style everywhere else. Every DB call in `otp.ts`/`users.ts`/`rate-limit.ts`/`audit.ts` went from SQLite's synchronous `.prepare().run()` to `pg`'s promise-based `query()`/`queryOne()` — mechanical but real, every call site across 7 API routes needed an `await` added; `tsc --noEmit` after the pass caught none missed. `pg`'s default TIMESTAMPTZ-as-`Date` parsing was overridden (`types.setTypeParser`) to keep returning ISO strings, so none of the carried-over SQLite-era logic (`new Date(row.expires_at)`, etc.) needed touching. Schema gained real Postgres constraints the SQLite version didn't have: FK `otp_challenges.user_id → users.id ON DELETE CASCADE`, CHECK constraints on `status`/`channel`/`purpose` enums. Signup's pre-check-then-insert has an inherent TOCTOU race under concurrency; added a catch for Postgres's `23505` unique-violation error code so a raced duplicate signup still returns the same clean 409 instead of an unhandled 500.

**Docker Compose gotcha worth remembering:** `${POSTGRES_USER}`-style substitution inside `docker-compose.yml` is resolved by `docker compose` itself before any container starts, and it only reads a file literally named `.env` in the project directory (or `--env-file`) for that — it does **not** read `env_file:` entries, since those only inject runtime env into an already-started container. `.env.local` (this project's existing single source of truth, used everywhere via `env_file:`) was silently invisible to compose's own interpolation — `docker compose config` showed `POSTGRES_USER`/`PASSWORD`/`DB` all defaulting to empty strings despite being correctly set in `.env.local`. Fixed by adding a second file, `.env` (new, gitignored same as `.env.local`), duplicating just the three `POSTGRES_*` values with a comment cross-referencing `.env.local` as the source of truth and a reminder to update both if the password ever rotates.

**Verified end-to-end against the live, actually-deployed containerized stack** (not just locally): `docker compose up -d --build` brought up all three containers (`socialpulse`, `socialpulse-db`, `socialpulse-tunnel`) healthy; ran real signup/login/OTP-verify/password-reset calls straight at `https://socialpulse.dotstark.tech` through the live Cloudflare tunnel, checked the resulting rows directly via `docker exec socialpulse-db psql` (password stored only as a 168-char scrypt hash, OTP stored only as a 64-char HMAC hex, never plaintext anywhere). Persistence explicitly tested and confirmed surviving: `docker restart socialpulse-db`, `docker compose up -d --build socialpulse` (app rebuild), and a full `docker compose down` (no `-v`) + `up -d` (recreates the network and every container, including the tunnel) — user row, `ACTIVE` status, and working login all survived every case. `pg_dump`/restore tested against a disposable temp database (`socialpulse_restore_test`, created, restored into, row-count-verified, dropped) — never run destructively against the live DB. Confirmed unrelated integrations still respond correctly post-migration: Whapi webhook, Meta WhatsApp webhook, LinkedIn/Facebook/Canva OAuth `auth` routes (redirect, not 500), protected-route redirect-when-logged-out. Test data cleaned out of the live DB after verification (`DELETE FROM users` etc.) — 0 rows at end of session, confirmed via `psql`.

**`tsc --noEmit` / `eslint`:** both clean across every file touched this session (`src/lib/db.ts`, all of `src/lib/auth/`, all of `src/app/api/auth/`, `src/app/login-signup/`, `scripts/`) — checked repeatedly through the session, not just once at the end.

**Uncommitted at end of this session — everything, 74 files (`git status --short`):** the routing restructure, the entire `src/lib/auth/` + `src/app/api/auth/` + `src/app/login-signup/` trees, `src/proxy.ts`, `src/lib/db.ts`, `scripts/migrate-sqlite-to-postgres.mjs`, and the `docker-compose.yml`/`Dockerfile`/`.gitignore` changes are all sitting in the working tree, never committed, never pushed — only asked to build/fix/deploy, not to checkpoint. The live site is running directly off this uncommitted tree (Docker builds from the local filesystem, not from git) — if this working tree is lost before a commit, the live deployment's *code* would need reconstructing from this handover, though the *data* is safe (named Postgres volume, independent of the app's source).

**Not migrated / deliberately out of scope this session (per the task's own explicit instruction):** Scheduler/Asset Gallery/Analytics/platform-connection data all still live in the pre-existing flat JSON files (`scheduled-posts.json`, `*-tokens.json`) and bind mounts — only auth/OTP moved to Postgres. `scripts/migrate-sqlite-to-postgres.mjs` exists as a documented, never-yet-run safety net for importing an old SQLite backup if one ever surfaces — the live deployment's prior SQLite file had already degraded into a stray empty directory with zero real rows before this session started, confirmed before writing anything, so there was nothing to actually migrate.

### Previous implementation handover (2026-09-23 — `/welcome` landing page + border/border-color fix — d979bf6 + uncommitted)

**New route `src/app/welcome/` (`page.tsx` + `landing-client.tsx`, 838 lines, committed `d979bf6`):** the user supplied a downloaded Claude Artifact export (`~/Downloads/socialpulse-landing.html`) and asked to use it as the app's landing page. That file wasn't plain HTML — it's a self-extracting "bundle" (a `dc-runtime` loader + gzip-compressed React/ReactDOM + the artifact's own component, stored as base64 in a `script[type="__bundler/manifest"]` tag, with the real markup as a JSON string in `script[type="__bundler/template"]`). Decompressed and extracted both (`python3 gzip.decompress` + `json.loads`) to recover the actual template (an `x-dc` custom-templating HTML tree using `{{ }}` bindings, `sc-for`/`sc-if` loop/conditional tags, and a `Component extends DCLogic` class with the page's state/animation logic) and hand-ported it into a proper Next.js client component — no dependency on the artifact runtime.

**Why a new route instead of replacing `/`:** the existing `/` already runs the real app (`SocialMediaManager` in `src/app/page.tsx`), and roughly ten OAuth callback routes (LinkedIn, Facebook, Canva, Instagram) hardcode `NextResponse.redirect(new URL('/?...', APP_ORIGIN))` to return there with connection state. Asked the user via AskUserQuestion; they chose the low-risk option (new route, app stays at `/`) over moving the app + rewriting every redirect. `/welcome`'s "Get Started"/"Get Started Free"/"Log in" all `<Link href="/">` into the real app; in-page nav (`#workflow`/`#platforms`/`#scheduler`/`#features`) just scrolls.

**What's on the page:** hero with a mouse-parallax 3D dashboard mockup (rAF loop lerping toward cursor position via refs, not state, to avoid re-render churn) + floating cards + Caveat-font handwritten annotations; an auto-advancing 6-step workflow carousel (step list + a 3D card stack, pauses on hover); a LinkedIn/Facebook/Instagram/WhatsApp caption preview switcher with a full-screen modal; a live drafts/scheduled/published scheduler demo (Schedule/Cancel actually move items between columns + fire a toast); a filterable asset gallery; a WhatsApp group multi-select with a "Send to N groups" toast; and a closing CTA with a rotating ring of platform icons. All demo data is local component state, resets on reload — nothing here talks to the app's real APIs.

**Conversion approach — `sx()` helper instead of hand-converting every style:** rather than manually rewriting ~700 lines of `style="prop:val;prop:val"` CSS-text into camelCase React style objects, wrote a small `sx(css: string): CSSProperties` parser (splits on `;`/`:`, camelCases each prop including vendor prefixes like `-webkit-background-clip` → `WebkitBackgroundClip`) and kept the original design's CSS strings almost verbatim, wrapped as `style={sx('...')}`. A `<Hover>` wrapper component (`onMouseEnter`/`onMouseLeave` + `sx(base)` merged with `sx(hover)` on hover) reproduces the artifact's `style-hover=""` attribute for the ~9 buttons that need it. `next/font/google` (Caveat, Plus Jakarta Sans) instead of the artifact's manually-split `@font-face`/`unicode-range` blocks.

**Bug found live and fixed (uncommitted):** user screenshotted a Next.js dev-overlay console error — *"Removing a style property during rerender (borderColor) when a conflicting property is set (border)..."* — at `landing-client.tsx:265`. Three `<Hover>` buttons ("See the workflow" ×2, "← Cancel to Drafts") set `border: 1px solid <color>` (shorthand) in `base` but only `border-color: <color>` (longhand) in `hover` — React's style diffing doesn't cleanly swap between a shorthand and its longhand on hover/unhover. Fixed by making `hover` also use the full `border` shorthand in all three spots, so base and hover always set the same property. Re-ran eslint on `src/app/welcome` after — clean, no other `border-color:`-only overrides left in the file.

**Deploy discovery — this project is NOT on Vercel despite `README.md` saying "Vercel-ready":** the user asked to also get this live on `socialpulse.dotstark.tech`. `git push origin main` failed with `remote: Repository not found` — from both this sandbox *and* the user's own terminal, and `github.com/devdotstark-oss/SocialPulse` also 404s in-browser for the user while logged in, so the local `origin` remote is simply stale (repo renamed/transferred/deleted — not re-diagnosed further, not blocking). Turned out to be moot: `socialpulse.dotstark.tech` is served by a `cloudflared tunnel run --url http://localhost:3001 socialpulse` process (PID checked via `ps aux`, running since Tue 04PM), pointed straight at the same `next dev -p 3001` instance already running locally. Since Turbopack hot-reloads from disk, the new `/welcome` files (and the border-fix) went live on the public domain automatically, with no push/deploy step at all — confirmed via `curl -o /dev/null -w '%{http_code}' https://socialpulse.dotstark.tech/welcome` → `200`. **Caveat flagged to the user but not acted on:** this is `next dev`, not a production build — fine for now, but not durable across a reboot or this terminal session closing; a `next build && next start` (or `pm2`) behind the same tunnel would be sturdier if this page needs to stay up unattended.

**`tsc --noEmit` / `eslint`:** both clean on `src/app/welcome/*`; the one pre-existing unrelated `tsc` error (`page.tsx:2837`, `StudioWorkspaceProps` missing `isSavingDraft`) is untouched, same as prior handovers.

**Uncommitted at end of this session:** `src/app/welcome/landing-client.tsx` (the border/border-color fix, 3 lines changed) — not committed, only asked to fix the bug and update this handover. The stale `origin` remote was also not fixed/re-pointed — if a future session needs to push, that needs sorting first (see Deploy discovery above).

### Previous implementation handover (2026-09-22 — Download/Edit-Prompt fixes + Pollinations fallback key — c111ae0 + uncommitted)

**Checkpoint commit `c111ae0`** (23 files, +4247/-669): the working tree already carried a large batch of prior-session uncommitted work — `connect-platforms.tsx`, per-platform preview components (`facebook-preview.tsx`, `instagram-preview.tsx`, `linkedin-preview.tsx`, `whatsapp-preview.tsx`), `scheduler-calendar.tsx`, `src/lib/instagram-trial.ts`, plus fixes across the Canva routes, `generate-content/route.ts`, `instagram/publish/route.ts`, `scheduler/check/route.ts`, `whapi/publish/route.ts`, `canva-return/page.tsx`, `page.tsx`, `studio-wizard.tsx`, `studio-workspace.tsx`, `canva.ts`, `posts.ts`. Nothing in this batch was authored this session — it was simply reviewed (no secrets in the diff) and committed as one checkpoint, same pattern as the 2026-09-16 checkpoint.

**Generated Media "Save" button now actually downloads (`studio-wizard.tsx`):** the button at the bottom of the AI-generated image/video preview (row: `↻ Regenerate → ✏️ Edit Prompt → 📥 Download → 🗑️ Remove`) previously called `p.saveFullDraft()` despite being labeled "📥 Save" — it saved a draft, it never saved a file to disk. Added `downloadGeneratedMedia()` (studio-wizard.tsx, near `saveDraft`): builds a hidden `<a download>` pointing at `p.generatedVideo || p.generatedImage` (both are same-origin `data:`/`blob:` URLs, so the `download` attribute works without a CORS fetch/blob step) and clicks it. Button relabeled "📥 Download".

**"Edit Prompt" button was a dead click (`studio-wizard.tsx`):** the image-prompt textarea (`studio-wizard.tsx:1049`) is `readOnly={useContentContext}`, and `useContentContext` defaults to `true` (`studio-wizard.tsx:240`) — the field is locked to "use post content as context" out of the box. The Edit Prompt button only called `.focus()`, so clicking it focused a read-only field and looked broken. Fixed: it now flips `useContentContext` off first (seeding `p.imagePrompt` with the same derived-from-content text the field was already showing, so it doesn't blank out) before focusing.

**Pollinations image-gen now has a fallback API key (`generate-image/route.ts`, `.env.local`):** added `POLLINATIONS_API_KEY_FALLBACK` alongside the existing `POLLINATIONS_API_KEY`. `callPollinations(key)` was factored out of the inline `fetch`; if the primary key's request fails for any reason *other than* Azure's content-safety block (400 + `/safety system/i`), it now retries once against `gen.pollinations.ai` with the fallback key before giving up. A safety-block on either key still short-circuits straight to `status:'blocked'` — retrying gibberish/unsafe prompts on a second key would never help. **The model itself still has no fallback** (`PRIMARY_MODEL = 'gpt-image-2'`, per the pre-existing "no fallback, no timeout limit (user requested)" comment) — this only adds redundancy for key-level failures (rate limit/quota/auth), not model outages. Dev server (`next dev -p 3001 -H 0.0.0.0`) was restarted to pick up the new env var — Next.js only reads `.env.local` at process start, unlike code which hot-reloads. Both `http://localhost:3001` and `https://socialpulse.dotstark.tech` confirmed `200` after the restart.

**`tsc --noEmit`:** clean except the one pre-existing, unrelated error (`page.tsx:2837`, `StudioWorkspaceProps` missing `isSavingDraft` — confirmed present before any of this session's edits via `git stash`, not introduced here).

**Uncommitted at end of this session:** `src/app/studio-wizard.tsx` (Download + Edit Prompt fixes), `src/app/api/generate-image/route.ts` (fallback key), `scheduled-posts.json` (runtime state, changes as the app runs). Not committed — only asked to fix the bugs and update this handover, not to checkpoint again.

**Not verified in a real browser this session** (no click-through was run against the live site) — confirmed via source-read + `tsc` + dev-server/tunnel `200`s only. Re-verify the Download button actually saves a file and the Edit Prompt field accepts typing before considering this fully done.

### Previous implementation handover (2026-09-20 — Studio redesign + WhatsApp + AI loader — a6c3569)

Committed as `a6c3569` (8 files, +2193/-751): `src/app/ai-image-loader.tsx` (new), `src/app/page.tsx`, `src/app/studio-wizard.tsx`, `src/app/studio-workspace.tsx`, `src/app/api/whapi/client.ts`, `src/app/api/whapi/publish/route.ts`, `src/app/api/whatsapp/publish/route.ts`, `src/lib/whatsapp-service.ts`. `tsc --noEmit` clean; `next dev -p 3001` + `cloudflared tunnel socialpulse` (9ada467b) both `200` local + public; no posts sent except isolated Whapi verification texts.

**Workflow is now 8 steps (was 6):** `1 Idea → 2 Settings → 3 Content → 4 Media → 5 Design → 6 Branding & Accessibility → 7 Preview → 8 Publish`. `STEPS` const, `goNext` clamp, `wizardState.currentStep` persistence, draft-resume jump (`schedule ? 8 : 3`), and all subtitles renumbered. Covers 1:1/16:9/9:16/4:3.

**Steps 1-4,7,8 premium UI redesign (UI-only, no route logic moved):** Step 1 (Idea) two-column with inspiration pills + lavender dropzone; Step 2 (Creative Settings) premium selectable cards (Tone/Image Style/Aspect) with `selectCardPremium` + platform connect; Step 3 (AI Content Editor) editable caption + persistent hashtag pills + tone pill; Step 4 (Media Studio) mode tabs `ai|upload|library`, gated AI prompt with `Use Content Context` toggle, hot `Generated Media` card; Step 7 (Preview) two-column with platform tabs, realistic post mock, readiness checklist; Step 8 (Publish) 2×2 platform grid with per-platform colored borders, Connected Accounts, WhatsApp chat picker, sticky publish bar. All handlers preserved.

**New pages Step 5 & 6 — strict separation (fixes prior duplication):**
- **Step 5 Design Studio** now *only* Canva (connect/create/edit/import), Post Format Single/Carousel + slide arrangement (`reorderCarouselSlide`, `toggleCarouselSlide`, `generateCarouselSlides`), and design editing. Branding/ALT moved out.
- **Step 6 Branding & Accessibility** now *only* Brand Logo/Colors/Fonts (`brandSwatches`, `headingFont/bodyFont`, `applyLogoToAllMedia`), `Brand Readiness` status, branded `Design Preview` (live logo overlay math + platform dropdown, draggable carousel thumbs), and `Image ALT Text` (`altTextControls`, `generateAltText`). Enforced by removal in `studio-wizard.tsx` — no duplication.

**WhatsApp Whapi — three regressions fixed:**
1. **Publish `403 group-announce-not-admin` now surfaced, not generic.** Whapi `POST /messages/text|image` to an announcement group where the connected number (`918882910380`) is not admin returns `403 {"details":"group-announce-not-admin"}`. `whapi/client.ts` now maps to `WHAPI_PERMISSION_DENIED` with admin message; `whapi/publish/route.ts` preserves `403` (was collapsed to `WHAPI_PUBLISH_FAILED` for media) and `whatsapp/publish/route.ts` + `page.tsx` toast the specific message: *“You are not an admin of this announcement group — only admins can post there. Choose a regular group from All groups, or make this number an admin.”* Verified: `Garvvvvv 120363410472336933@g.us` (regular) `sent:true`; `Testerrrrrrrrrrrr 120363413190194893@g.us` (announce, member) `403`.
2. **Picker now shows both Communities + All groups reliably.** `getWhatsAppCommunities()` now prefers `GET /communities` + `GET /communities/{id}/subgroups` → `announceGroupInfo.id` (required — sending to parent JID is always `400`), falls back to `/groups` inference. Live: `13 communities` (was 2) and `169 groups` total; picker `Community (13)` + `All groups (~156 deduped)`. `loadWhapiGroups` (`page.tsx:635`) is now tolerant — if communities is slow (8-22s) or fails, groups still render; previously it threw away groups.
3. **Double hashtags in WhatsApp posts — fixed.** `content` already contained `caption + "\n\n" + hashtags` (`page.tsx:1355`), then `publishToWhapi` appended `formatHashtags` again → 14 tags in screenshot. Added `stripTrailingHashtags()` (`page.tsx:110`) and rebuilt all publish paths (`publishToWhapi`, `publishToAll` WhatsApp + LinkedIn/Facebook scheduler) from *stripped caption + single hashtag block*.

**Branding — replace-not-stack + double-logo fixed:**
- Empty-gallery apply previously created a random `with-logo` id each time, stashing original under `gen` — later Changes burned on stale bytes and stacked. Now stable `GEN_ID='gen-logo'`, originals keyed by item id, **replace-in-place** (no duplicate gallery items). `clearLogo()` now also `restoreBurnedMedia()` (swaps stashed originals back, clears `burnedLogoIds`) so Remove returns clean pixels. Burning `generatedImage` now flags both `GEN_ID` and `gen` so overlays (`burnedLogoIds['gen']` check in `page.tsx:3638`, `studio-wizard.tsx:1638/1883`) correctly hide. Geometry tweaks (`position/scale/opacity`) now revert burns to originals via `geometryTouchedRef` guard (draft restores don't trigger). Verified against 10-step test: Apply A → Change B/C → only latest visible; geometry change → single overlay; Remove → clean original.

**AI image generation — gated premium loader + lost-job fix:**
- New `src/app/ai-image-loader.tsx` (302 lines): canvas particle field (`#05070B`, `#2563EB/#3B82F6/#60A5FA`, 300-1500 dots by viewport, sine + sweep + radial glow, `requestAnimationFrame`, hidden-tab pause, `prefers-reduced-motion` static, no per-frame React state). **Gated progress** (`working`→`ready`→`finishing`→`error`): `0→97` eased over `14s`, **hold 99** if backend slow, **wait silently** if backend fast, `99→100` sprint only when both ready, veil brightens `200ms` then fades `450ms` + image `0.97→1.00` (`sp-ai-arrive`). Label `Thinking` top-left, pill progress bottom-right. Error → dimmed field + `Try Again` (prompt preserved, no fake `100%`). Integration: `genGate/genRunId/genFinishing` in `studio-wizard.tsx` (`Generated Media` card) — image never appears before `onReveal`.
- `pollImageJob` (`page.tsx:1364`) no longer throws `Lost track of the image job` as unhandled overlay on `404` after dev restart (in-memory `jobs` map cleared). Now returns `{status:'error', message:'Server restarted…'}` and retries transient network; `scheduled-posts.json` job TTL `15m`.

**Env/config:** `NVIDIA_TEXT_FALLBACK_MODEL` corrected from `meta/llama-3.2-11b-vision-instruct` (vision model was in text fallback slot) to `nvidia/nemotron-3.5-lightning-30b-a3b` (` .env.local:19`, gitignored, server restarted) to honor Mercury 2.5 → Nemotron chain.

### Previous implementation handover (2026-09-17 — project workflow reference doc)

Documentation-only, no code touched. Produced a single-page visual reference of the whole app's workflow, derived by reading `README.md`, `HANDOFF.md`, this file, and the actual source (`src/app/page.tsx`, `src/app/studio-wizard.tsx`, the `src/app/api/*` routes) rather than from memory. Covers: the four-layer architecture (client UI → Next.js API routes → external model/platform APIs → flat-JSON storage), the six-step Content Studio wizard (Topic → Creative Settings → Review → Media & Branding, including the Canva edit loop → Preview → Publish), the three generation pipelines (Nemotron text, Minimax/Llama vision, gpt-image-2 via Pollinations), every platform connector (LinkedIn, Facebook, Instagram-via-Facebook, WhatsApp's Meta/Whapi dual path, Canva OAuth+PKCE), the post lifecycle state machine (Draft → Pending → Publishing → Published, with the Cancel/Reschedule guard), and the on-disk storage files.

Published as a private Claude Artifact and also saved locally at `~/Desktop/socialpulse-workflow.html` (self-contained; only external dependency is a Google Fonts stylesheet link). Not linked from any in-app page — a standalone reference for whoever picks up this project next.

### Previous implementation handover (2026-09-16 — Reschedule/Cancel + Drafts sort + UI polish)

Implemented the Reschedule/Cancel/Drafts spec end-to-end (backend + UI), then two rounds of UI polish requested live against screenshots of the running app.

**Data model (`src/lib/posts.ts`):**
- `PostRecord.previousScheduledAt` — new field. `cancelPost()` now stashes the post's last `scheduledAt` here before clearing it, so a cancelled post keeps a record of when it *was* going out even though it's back in Drafts with `scheduledAt: null`.
- `reschedulePost(post, scheduledAt, now)` — new. Only a `pending` post can move (refuses `publishing`/`published`/etc. with "This post cannot be rescheduled. It may already be publishing."), which is also what stops a reschedule from racing the publish worker's claim.
- `newestDrafts()` — resort: descending by `previousScheduledAt` (later time first, per spec's example), falling back to `createdAt` for ties or drafts that were never scheduled.

**API (`src/app/api/scheduler/route.ts`):**
- New `PATCH` — `{id, scheduledAt}`, validates ≥5 minutes out, calls `updatePost(id, p => reschedulePost(p, scheduledAt))`. Updates the *same* post id — no duplicate job, since there was never a separate job store to begin with (the scheduler is a poll-by-status-and-time design, so mutating `scheduledAt` in place is sufficient).
- Existing `DELETE` (cancel) and the claim-before-publish check in `scheduler/check/route.ts` were already correct and untouched — cancelling before the worker claims a post (flips it to `publishing`) works; cancelling/rescheduling after that point correctly fails.

**Frontend (`src/app/page.tsx`, `src/app/post-preview.tsx`):**
- Cancel now opens a styled confirmation modal ("Cancel Scheduled Post?" / Keep Scheduled / Cancel Post) instead of `window.confirm`; success toast reads "Post cancelled and moved to Drafts."
- New Reschedule modal (native date+time inputs, 5-minute-minimum validation) wired to the PATCH endpoint.
- Reschedule + Cancel buttons added to: `PostPreview` cards, the Scheduler's Calendar week-grid day cards, and the Scheduler list view. Cancelling from either Calendar surface redirects to Content Studio (`setActiveTab('studio')`) per spec.
- `PostPreview` redesigned: colored status pill, colored platform chips, a 🕐 time badge (live `scheduledAt` while pending, `previousScheduledAt` once back in Drafts), rounded/bordered media, and a "Publishing — can no longer be cancelled" state that hides the action buttons instead of letting them 404.
- Added a shared `PillButton` component (icon + hover lift + active state) and restyled the previously-unstyled raw `<button>` nav rows (Scheduler's Drafts/Scheduled/Published/Preview/Calendar/Timeline pills, and the same shortcuts on the Drafts page) — these were flagged live via screenshots as looking like unstyled browser buttons.
- Card action buttons (`Btn` component in `post-preview.tsx`) now have icons, a hover lift, and real hierarchy: **Schedule Again**/**Reschedule** are purple-gradient primary buttons (the useful next step), Cancel/Delete stay red/destructive, Preview/Edit stay neutral outline.

**Verified:**
- `tsc --noEmit` and `eslint` clean on every touched file (same pre-existing lint-error baseline elsewhere in `page.tsx`, nothing new introduced).
- Exercised the new API directly against the dev server with a disposable test post (not through the UI — the Chrome extension wasn't connected this session): create → reschedule (success, same id) → reschedule <5min out (400) → reschedule nonexistent id (409) → cancel (→ draft, content preserved, `previousScheduledAt` set) → cancel again (409, can't double-cancel) → reschedule a draft (409, guard holds) → cleaned up. Confirmed `scheduled-posts.json` byte-identical to before the test (no leaked test data).
- **Not verified in a real browser** (extension unavailable) — the user then screenshotted the live `socialpulse.dotstark.tech` site during this same session and drove two more rounds of fixes from those screenshots (unstyled nav buttons, then a general "make more attractive" pass). Re-verify visually before considering this fully done.

**Server state as of this handover:** `next dev -p 3001 -H 0.0.0.0` running (matches `cloudflared` tunnel `socialpulse` origin `localhost:3001`, tunnel process was already alive from a prior session — pid 5110 at start of this session, not restarted). Both `http://localhost:3001` and `https://socialpulse.dotstark.tech` confirmed `200` after every change in this session.

**Checkpoint commit:** the working tree carried a large amount of prior-session uncommitted work (Whapi, WhatsApp, Instagram, privacy page, OAuth-return, etc. — all previously described as live-verified in the 2026-09-15 section below but never committed). Per this session's explicit "save this work" request, and after confirming `scheduled-posts.json` has zero embedded `accessToken` values and `.env*`/token-vault files are gitignored, everything was committed together in one checkpoint (see git log). An empty stray file named `200` (0 bytes, looked like accidental `curl -o` output sitting in repo root) was left untracked, not committed.

### Previous handover (2026-09-15 — Whapi + token rotation)

Implemented Whapi-based WhatsApp existing-group publishing as a **separate connector** from official Meta WhatsApp (`/api/whatsapp` untouched). Whapi channel `WONDRW-9VFNS` (`https://gate.whapi.cloud`, token `WHAPI_API_TOKEN` in `.env.local:62-63` server-only, never logged) was already authorized. **2026-09-15 16:50 IST — account rotated to new token `rLYsltEwy…` → new channel `SPRWMN-TTNTU` `AUTH`, `.next/dev` + `whapi-events.log` cleared, `nohup npm run dev -p 3001` restarted, `GET /api/whapi/status 200 100 groups` re-verified, no posts sent during rotation as requested, strictly use `SocialPulse Testing🚀 • 3 • announcement_group 120363429622982588@g.us` henceforth.**

**Added:**
- `src/app/api/whapi/client.ts` — `getWhapiConfig()` + `whapiFetch()` Bearer, `whapiError()` sanitized, `maskPhone()`
- `GET /api/whapi/status` → `GET /health` → `{connected:true, channelStatus:"AUTH"}` else `NOT_CONFIGURED|UNAUTHORIZED|NOT_CONNECTED`
- `GET /api/whapi/groups?count=100` → `GET /groups` → normalized `[{id:"120363...@g.us", name, participantsCount, type:"group"|"announcement_group"|"community", isParent, isCommunityAnnounce}]` (existing groups only, no personal chats)
- `POST /api/whapi/publish` `{groupId, text, mediaList:[{url,type}], attemptId}` — validates `@g.us` + fetches groups to confirm `groupId` exists, rejects `WHAPI_GROUP_NOT_FOUND`, supports Text, Single image+caption (`/messages/image` dataURL or https), Video+caption (`/messages/video`), Document, single-media only (no fake carousel), `seenAttempts` 15m duplicate guard + `publishingRef` + 10s cooldown, no hidden retries
- `POST /api/whapi/webhook` separate from `POST /api/whatsapp/webhook` — handles `messages.post/statuses.post`, sanitized to `whapi-events.log`, `GET` health check. Public URL `https://socialpulse.dotstark.tech/api/whapi/webhook`
- Frontend: `src/app/page.tsx:215` whapi states + `refreshWhapiStatus/loadWhapiGroups/publishToWhapi` (reuses `publishingRef`/`cooldown`), `src/app/studio-workspace.tsx:173` props, `src/app/studio-wizard.tsx:1196` Step 6 `WhatsApp ● Connected via Whapi` block — Destination `Existing Group`, Group picker `[Select group ▼]` + `↻` refresh, Status `Connected via WhatsApp`, `[📨 Publish to WhatsApp]` (disabled until group+content, respects cooldown), lazy fetch only when needed.

**Live verified 2026-09-15 on `socialpulse.dotstark.tech` (next-server rebuilt + `cloudflared` tunnel `socialpulse` 9ada…):**
- `GET /api/whapi/status` `200 {"connected":true,"channelStatus":"AUTH","channelId":"WONDRW-9VFNS"}` both local+public (then rotated to `SPRWMN-TTNTU` `200` after token `rLYsltEwy…`, `100` groups re-verified)
- `GET /api/whapi/groups` `200 100/155` groups (e.g. `Minor project 120363410795467871@g.us 3`, `Pce_Batch_2023-2027 503`, community types `community`/`announcement_group` correctly typed; strictly use `SocialPulse Testing🚀 • 3 • announcement_group 120363429622982588@g.us` henceforth per user instruction)
- `POST /api/whapi/publish` text to `Minor project` → `200 {"sent":true,"message":{"id":"PspNjDBVJ8X..."}}` — **visible in real WhatsApp group**
- `POST /api/whapi/publish` image+caption (200x200 red square 1.3KB) → `200 {"type":"image"}` — **visible**
- `video` (313b mp4 stub) → `200 {"type":"video"}` — verified, `multiple media` correctly sends first only
- `invalid group` → `400 WHAPI_GROUP_NOT_FOUND`, `duplicate attemptId` → `409 WHAPI_DUPLICATE_REQUEST`, `contact @s.whatsapp.net` rejected — all guarded
- `Team rocket` & other groups → `402 WHAPI_TRIAL_LIMIT` (free plan limited to one group) correctly surfaced with upgrade hint; `SocialPulse Testing` strict publish requires paid plan — `Minor project` is trial-whitelisted
- Meta `GET /api/whatsapp/status` still `NOT_CONFIGURED` (`WHATSAPP_ENABLED=false` unchanged), `GET /api/facebook|linkedin|instagram/status` still `true` — no regression, `npm run build` `✓ Compiled` with 4 new `ƒ /api/whapi/*` routes.
- `GET /api/whapi/webhook` `200`, `POST {"event":"messages.post"}` → `200` logged.

### Previous handover (2026-09-14 — UX)

The user resumed work with the attached UX/product specification and "continue". Implemented schedule cancellation into Drafts, full draft snapshots and editing/rescheduling, a preview-first planner with existing calendar/timeline retained, per-image ALT editing and vision generation, supported Meta image ALT payloads, and popup OAuth with IndexedDB redirect restoration. Existing publishing remains explicitly user-triggered; no automatic publishing or hidden publish retries were added.

Validation: seven isolated API/model/render tests pass, TypeScript passes, and git diff whitespace checks pass. Earlier isolated Chrome tests passed for draft cancellation, accessibility editing, redirect snapshot restoration, and Canva/LinkedIn/Facebook/Instagram popup returns. A final Chrome rerun after the last callback-state and save-guard changes was blocked by automatic approval review due to an account usage limit; do not present that rerun as passed. New helper/server modules pass targeted lint; the existing large page/wizard still have React lint errors. No live provider authorization, real social publishing, or live vision generation was tested in this work.

The dev server was started on port 3001 for tests. Public tunnel health was not reverified. Existing scheduled records and prior uncommitted changes were preserved; no commit was made. WhatsApp remains disabled with no implemented OAuth flow, and LinkedIn company Page API access/setup remains pending. Resume from the report's pending checks rather than restarting platform setup.

### Earlier pause instruction (historical)

Earlier request: **leave everything and update this handover**. That pause was superseded by the subsequent UX implementation request. Publishing, WhatsApp implementation, API access requests, and app setup were not resumed as part of the UX work. During the earlier documentation update only local files/configuration and git status were checked; live account validity was not rechecked.

### Platform state at pause (2026-09-15 — after Whapi + token rotation)

| Platform | Latest recorded state | Evidence / remaining work |
|---|---|---|
| Instagram | Connected | 16:49 screenshot shows Connected; account `@dotstark_technologies` is linked to the SocialPulse Facebook Page. Real Instagram publishing remains untested and was deferred by the user. |
| Facebook | Connected | Same screenshot shows Connected. Earlier sessions recorded successful real publishing. |
| LinkedIn personal | Connected per user | `GET /api/linkedin/status` `true` `M8JawOBycD Jai Luhach` live-verified 2026-09-15. |
| LinkedIn company Page | Setup incomplete | Dedicated app `263830053`; Community Management API Request access enabled, but no submission/approval or company publishing implementation confirmed. |
| WhatsApp (Meta) | Disabled locally | `.env.local`: `WHATSAPP_ENABLED=false`; credentials retained `1288066011058334`. `GET /api/whatsapp/status` `NOT_CONFIGURED` unchanged — not touched for Whapi. |
| WhatsApp (Whapi) | **🟢 Connected** `SPRWMN-TTNTU` `AUTH` (was `WONDRW-9VFNS`) | `GET /api/whapi/status` `200 connected:true` live-verified 2026-09-15 (rotated `rLYsltEwy…`, `100` groups). Strict group `SocialPulse Testing🚀 • 3 • announcement_group 120363429622982588@g.us` — `402 WHAPI_TRIAL_LIMIT` on free plan (only `Minor project 120363410795467871@g.us` works), `POST /api/whapi/webhook` separate, `https://socialpulse.dotstark.tech/api/whapi/webhook` handles `messages.post/statuses.post`. No posts sent during rotation as requested, cache cleared. |
| Canva | Cookies cleared; status unverified | Browser blocked status-page navigation after reset. No subsequent reconnect confirmed. |

### Instagram implementation and verification

- Enabled Instagram selection and Connect controls in Steps 2 and 6 of `src/app/studio-wizard.tsx`.
- Connect continues through Facebook Login for Business. Facebook callback discovers linked Instagram accounts and stores Page tokens server-side; Instagram status/publish resolve from that vault.
- Added `src/lib/instagram-media.ts` and `src/app/api/instagram/media/[id]/route.ts`. Uploaded/generated PNG/JPEG/WebP data URLs become 1080×1080 JPEGs with white padding and no cropping. MP4 uploads are staged too. Limits: 20 MB image input, 100 MB video input, 40 million Sharp input pixels.
- Files are staged in gitignored `.instagram-media/`, served through random 48-hex-character URLs with byte-range support. Access expires after 24 hours; expired files are cleaned on subsequent uploads/access, not by a timer.
- Requires the local server and public HTTPS tunnel (`NEXT_PUBLIC_APP_URL`) to remain running. External HTTPS media URLs pass through and must already satisfy Instagram's format requirements. Shared object storage is future work for serverless/multiple instances.
- Added container-readiness checks before single-image/Reel publishing and before carousel parent/publish steps. Polling is bounded: 12 checks, 3-second gaps, 10-second timeout per status request. No durable background publishing job or automatic publish retry.
- Image-only carousels are an **app limitation**, not a universal Instagram API rule. UI supports 2–9 slides; backend rejects more than 10.
- Duplicate-attempt protection is process-memory only (15-minute TTL). Instagram Deselect clears frontend state; its no-op disconnect route does not revoke the Facebook-derived connection, which can reappear on refresh.
- Validation: TypeScript passed; targeted ESLint passed for the helper/media route/publish route. Mocked checks passed for JPEG conversion, path rejection, byte ranges, single/carousel readiness ordering and duplicate suppression. No external publishing calls were made by those tests.
- **OAuth connection is demonstrated. Actual Instagram delivery and Meta fetching staged media have not been tested.** User said to leave that test for later.

### Meta setup — corrected facts and successful connection

- App **SPif**, ID `1498999398603391`, uses Facebook Login for Business configuration **SocialPulse Instagram**, ID `1058584533638121`. Preserve `config_id`; do not revert to raw scopes.
- Instagram professional account and Facebook Page linking were verified in user screenshots: DotStark / `@dotstark_technologies` linked to **SocialPulse** Page.
- Initial OAuth showed App not active. SPif was Unpublished, Dot Stark was listed as Administrator, and Required actions was empty.
- User saved privacy URL `https://socialpulse.dotstark.tech/privacy`, selected Education category, and published SPif. Alert Inbox confirmed live-mode change. Login then showed Feature unavailable.
- Actual configuration initially contained five permissions: `business_management`, `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_content`, `pages_show_list`. **Earlier handover claims that Instagram permissions were already selected were incorrect.**
- User opened Use cases → Manage messaging & content on Instagram → **API setup with Facebook login**, clicked Add required content permissions, then saw `instagram_basic` and `instagram_content_publish` as Ready for testing.
- Returned to existing configuration and selected those two permissions. Screenshot confirmed **seven selected permissions**: original five plus `instagram_basic` and `instagram_content_publish`.
- Fresh OAuth in Chrome subsequently returned to SocialPulse with Facebook and Instagram Connected. Do not claim the full preceding error sequence had only one proven cause.
- `instagram_business_*` permissions and the separate Instagram app credentials belong to **Instagram Login**, not this implemented Facebook Login path.
- Meta settings screenshots still showed Facebook's homepage as Terms of Service and data-deletion instructions URLs; SocialPulse-specific replacements were not implemented. Education category should accurately reflect the app's actual purpose.

### Cache/disconnect event and server startup

- Started Next dev on port 3001 and the existing `socialpulse` Cloudflare tunnel. Local and public `/` returned HTTP 200 after the public endpoint initially returned 530. Old PIDs 35089/1518 below are historical; recheck processes before restarting.
- Current `next.config.ts` external packages include **both `ffmpeg-static` and `sharp`**.
- At user's request, called LinkedIn/Facebook disconnect endpoints. LinkedIn scrubbed credentials from four scheduled posts; Facebook reported zero. `scheduled-posts.json` is modified; no posts were deliberately published or deleted.
- Facebook vault clearing also disconnected derived Instagram. Added `WHATSAPP_ENABLED` guard to `src/app/api/whatsapp/client.ts`, set flag false in `.env.local`, retained credentials.
- Temporarily served `Clear-Site-Data: "cache", "cookies"`, verified the header publicly, refreshed the in-app browser, then **removed the temporary header**. It must not remain enabled during OAuth. Drafts were preserved.
- LinkedIn/Facebook/Instagram/WhatsApp status endpoints then reported disconnected; Canva verification was blocked by the browser. Later reconnections supersede that reset state for the three social platforms.

### LinkedIn company Page — corrected blocker and exact resume point

- Existing personal app: SocialPulse, developer portal app ID **264502083**. Source still requests `openid profile email w_member_social` and publishes with `author: urn:li:person:${userId}`.
- **Company Page publishing is not implemented in the current route.** Adding a scope alone will not make a company picker/publishing path work.
- Hover tooltip on the original app explicitly said Community Management API must be the **only product on its application**. Other provisioned products/pending requests blocked requesting it. Tooltip recommended a new developer app.
- This disproves the earlier diagnosis that the disabled button itself showed Partner Program gating. Do not repeat that claim.
- User created **SocialPulse Pages**, associated with existing **Dotstark Technologies** company Page. New developer portal app ID: **263830053**.
- New app Products: https://www.linkedin.com/developers/apps/263830053/products
- Initially disabled; latest screenshot at **17:57:48 IST** clearly shows **Community Management API → Request access enabled**. No access request submission or approval has been confirmed.
- Latest guidance was to click Request access for **Community Management API only** and send the resulting form/dialog. This is where to resume when requested. No further developer app or company Page creation is needed.
- Final settings/Page verification status, new credentials and OAuth redirect have not been inspected/configured. Do not replace the existing personal app credentials.
- Future implementation after appropriate access: separate company-app OAuth/credentials, permitted organization scopes (reviewed Posts API uses `w_organization_social`), authorized Page selection, organization authorship and matching media ownership. Preserve personal-profile posting.
- User pasted API Terms revised December 2022. Explained Section 3.1's automated-posting restriction and Section 1.2's additional vetted-program terms governing conflicts. App creation is not blanket scheduling authorization. Describe the intended publishing/scheduling flow accurately in the application; no legal-clearance determination was made.
- References reviewed: https://www.linkedin.com/legal/l/api-terms-of-use ; https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api ; https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login

### WhatsApp and other remaining work (updated 2026-09-15)

- **Whapi existing-group publishing now DONE** per TARGET FLOW: `GET /api/whapi/status` + `GET /api/whapi/groups` (155 total, 100 paginated) + `POST /api/whapi/publish` (Text, Image+caption, Video+caption, Document) + `POST /api/whapi/webhook` separate from Meta (`whapi-events.log` sanitized). Live-verified with real existing groups (`Minor project 120363410795467871@g.us`), real messages visible (`PspNjDBV...` text, `Psrsws0X...` image, `PsoQiml...` video), invalid-group `400 WHAPI_GROUP_NOT_FOUND`, duplicate `409 WHAPI_DUPLICATE_REQUEST` all guarded. Frontend Step 6 `WhatsApp ● Connected via Whapi` + group picker + `📨 Publish to WhatsApp` (reuse 10s cooldown, one-click-one-request) is live.
- **Meta WhatsApp remains deliberately disabled** (`WHATSAPP_ENABLED=false`); its routes (`status`/`groups`/`whapi` not touching) and `400 #131215` OBA gate are historical and unchanged — Whapi is the existing-group path. Do not remove/merge the two.
- Community support: `GET /api/whapi/groups` already returns `type:"community"|"announcement_group"|"group"` with `isParent/isCommunityAnnounce/linkedParent` preserved. Announcement groups (e.g. `Trae @New Delhi 120363408327448802@g.us 303`) have dedicated `isCommunityAnnounce:true` IDs — use that exact ID, not parent community ID. Current publish prioritizes normal `type:"group"`; community parent posting not blindly implemented.
- Earlier October 3 OBA estimate is **not guaranteed** for Meta path and irrelevant to Whapi. Existing Meta `invite-link` routes must not be assumed for arbitrary groups.
- Scheduler remains manual POST `/api/scheduler/check`; no automatic scheduler. Whapi publish is immediate-only (not scheduled) by design. `publishedCount` also increments for failed processed posts (unfixed).
- Mercury → Nemotron content generation, NVIDIA vision, Pollinations `gpt-image-2` background generation, media/carousel/branding/Canva flows remain as described historically. README and old OpenCode model notes are stale. Content scenarios 1/2 still use long synchronous requests.
- Whole-project lint has pre-existing issues; `npm run build` now `✓ Compiled` with 4 new `ƒ /api/whapi/*` routes, `tsc` clean. Local JSON and in-memory `seenAttempts` guards need production hardening.
- Chrome control initially failed for missing permissions, later succeeded; user resumed manual setup. Chrome and in-app browser have distinct login sessions.

### Working tree at handover

No commit made. `git status --short` includes modified `.gitignore`, this document, `scheduled-posts.json`, Facebook auth/callback/vault, generation routes, Instagram auth/callback/publish, LinkedIn callback/vault, scheduler routes, `page.tsx`, `studio-wizard.tsx`, `studio-workspace.tsx`. Untracked source includes Facebook status, Instagram disconnect/status/media, LinkedIn status, WhatsApp routes, privacy page, and `src/lib/instagram-media.ts`. Changes include work predating this session.

Vaults may contain newly reconnected credentials: **do not assume they are empty**. Never log secrets or credential prefixes. Inspect/sanitize tracked scheduled-post data before a future commit. The documentation update itself changes only this Markdown file.

---

## HISTORICAL NOTES — earlier sessions, not current state

The sections below preserve prior implementation context. Current status, next steps and corrected explanations above take precedence, especially for Instagram standby, LinkedIn partner gating, WhatsApp enablement, token-vault emptiness and process IDs.

## Instagram implementation update — 2026-09-14

This section supersedes earlier Instagram standby/public-media-blocker notes below.

- Instagram is enabled in Steps 2 and 6, with Connect via the existing Facebook Login for Business config_id flow.
- Generated/uploaded PNG, JPEG and WebP images are normalized to 1080-square JPEG (white padding, no cropping). MP4 uploads are also staged. Temporary files live in gitignored `.instagram-media/`; unguessable public URLs expire after 24 hours and expired files are cleaned on subsequent uploads/access.
- Requires a continuously running local server + public HTTPS tunnel (`NEXT_PUBLIC_APP_URL`). This filesystem implementation is for the existing single-server setup; use shared object storage for serverless/multiple instances. External HTTPS media URLs are passed through and must already meet Instagram's requirements.
- Single images, image carousels and Reels wait for container readiness before publishing. Processing checks are bounded; long-running processing returns an explicit not-published error. No automatic publish retry.
- The Instagram Deselect button removes the local selection; the account connection is derived from Facebook and can reappear on reload.
- Meta's Facebook Login documentation lists `instagram_basic`, `instagram_content_publish`, `pages_show_list`, and `pages_read_engagement`. Earlier notes listing `instagram_business_*` correspond to a different login API. Verify the actual configuration grants on reconnect; preserve config_id rather than replacing it with raw scopes.
- Validation: TypeScript and targeted backend ESLint pass. Mocked integration checks cover JPEG conversion, path rejection, byte ranges, single/carousel readiness ordering and duplicate suppression. No real Instagram post was published; account linking/permissions and public media retrieval by Meta still require an account-connected test.

## Real Project

Use this repo:

`/Users/admin/Desktop/ScoialPulse_OG/social-media-manager`

Older docs mention `/Users/admin/Desktop/ALONEai copy/social-media-manager`; that is stale for this machine/session. Do not edit the old path unless the user explicitly asks.

The tree has substantial uncommitted work (see "Uncommitted this session" below). Do not run `git checkout .`, `git reset --hard`, or stash/drop casually.

## Run / Live URL

Local dev server:

```bash
npm run dev -- -p 3001 -H 0.0.0.0
```

Public Cloudflare Tunnel URL:

`https://socialpulse.dotstark.tech`

Cloudflare tunnel:

- Tunnel name: `socialpulse`
- Tunnel ID: `9ada467b-635d-44c5-bc97-4f2c1d7c5621`
- DNS route: `socialpulse.dotstark.tech`
- Origin: `http://localhost:3001`

Run tunnel connector:

```bash
cloudflared tunnel --url http://localhost:3001 run socialpulse
```

There is also an existing Cloudflare tunnel named `dotstark` for another project. Leave it alone.

As of this update both processes are alive on this machine: `next-server` (rebuilt 2026-09-15 16:50 IST, env reloaded with Mercury + Meta WhatsApp prod + Whapi `rLYsltEwy…` → `SPRWMN-TTNTU` `AUTH`, `rm -rf .next/dev` + `whapi-events.log` cleared, no posts during rotation), port 3001, and `cloudflared` `socialpulse` `9ada...` (pid **13259** since 09:41), tunnel verified serving `HTTP/2 200` at `https://socialpulse.dotstark.tech/` and `https://socialpulse.dotstark.tech/api/whapi/status|groups` `200`.

## Important Live Config

`next.config.ts` includes:

- `allowedDevOrigins: ['127.0.0.1', 'socialpulse.dotstark.tech']`
- `serverExternalPackages: ['ffmpeg-static', 'sharp']`

`.env.local` points public app/OAuth callback URLs at:

- `NEXT_PUBLIC_APP_URL=https://socialpulse.dotstark.tech`
- `LINKEDIN_REDIRECT_URI=https://socialpulse.dotstark.tech/api/linkedin/callback`
- `CANVA_REDIRECT_URI=https://socialpulse.dotstark.tech/api/canva/callback`
- `FACEBOOK_REDIRECT_URI=https://socialpulse.dotstark.tech/api/facebook/callback`
- Meta WhatsApp webhook (registered and verified this session): `https://socialpulse.dotstark.tech/api/whatsapp/webhook` (Meta `WHATSAPP_VERIFY_TOKEN=de37db...`)
- Whapi webhook (new, separate, handles `messages.post/statuses.post`): `https://socialpulse.dotstark.tech/api/whapi/webhook` (`WHAPI_API_BASE=https://gate.whapi.cloud`, `WHAPI_API_TOKEN` server-only, channel `SPRWMN-TTNTU` `AUTH` — was `WONDRW-9VFNS` before rotation, strictly `SocialPulse Testing🚀 120363429622982588@g.us` henceforth)

## Platform connection status (live-checked 2026-09-15, post-Whapi)

| Platform | Status | Notes |
|---|---|---|
| **LinkedIn** | 🟢 Connected | `GET /api/linkedin/status` `200 M8JawOBycD Jai Luhach` live-verified 2026-09-15. Scopes `openid profile w_member_social email` only; `Products > Community Management API` still grey `Development Tier → Request access` — partner-gated. Personal `urn:li:person` posting works; Company Page `urn:li:organization` will `403` until `Added`. |
| **Facebook** | 🟢 Connected | `GET /api/facebook/status` `200 Dot Stark SocialPulse 1212444681962661` live-verified. `config_id 1058584533638121` flow intact. |
| **Instagram** | 🟢 Connected | `GET /api/instagram/status` `200 @dotstark_technologies 17841432705293724` live-verified. Still on standby UI by user choice. |
| **WhatsApp (Meta)** | 🔴 Not configured | `GET /api/whatsapp/status` `NOT_CONFIGURED` (`WHATSAPP_ENABLED=false` deliberate, unchanged for Whapi). Groups `POST /{phoneId}/groups` → `400 #131215` `oba_status: NOT_STARTED` (OBA gate, not touched). |
| **WhatsApp (Whapi)** | 🟢 Connected `WONDRW-9VFNS` `AUTH` | `GET /api/whapi/status` `200 connected:true` local+public. `GET /api/whapi/groups` `100/155` groups (e.g. `Minor project 120363410795467871@g.us` used for real text `PspNjDBV...` + image `Psrsws0X...` publishes visible). Webhook separate `https://socialpulse.dotstark.tech/api/whapi/webhook` `200`. No token leakage. |
| **Canva** | 🟢 Connected | `GET /api/canva/status` `200` live-verified — cookie `canvaConnected:true`. |
| **Privacy** | 🟢 Live | `https://socialpulse.dotstark.tech/privacy` `200` local + public tunnel. |

## This session's real work

### 1. Full end-to-end test pass (user supplied an 18-section test prompt "for OpenCode/Claude")Executed directly rather than delegated. Real API calls (not just code reading) for: Scenario 1 (text→content, passed), Scenario 3 (text→image background-job/polling, passed), Scenario 2 (image→content - first attempt hit a genuine transient NVIDIA vision 500, confirmed via server logs as an external provider flake and NOT a bug, retested immediately with a real generated image and passed cleanly). Also verified: no automatic scheduler exists (scheduler/check is manual-button-only), **SUPERSEDED 2026-09-13 — carousel was built (see "Carousel feature" section below).** Original note kept for history: **no carousel feature exists anywhere in this codebase** (only a CSS animation name matches "slide"). branding/logo feature is real and substantial (5 positions, preview math matches actual ffmpeg burn-in positions), unified media flow confirmed (generated/uploaded/varied/logo-applied/Canva-imported media all use the same `mediaItems` array), media limits enforced both client- and server-side, publish safety guards (one-click-one-request, 10s cooldown, no auto-retry) all confirmed in code, disconnect routes confirmed to actually scrub `scheduled-posts.json` too (not just the vault). Lint diffed directly against the git baseline (temporarily swapped `page.tsx` for its HEAD version in place, linted, restored) - confirmed zero new issues introduced by any session's work.

### 2. Live browser verification of Instagram's standby UI (via claude-in-chrome)
User asked "can you do it in front of me in UI too?" - actually drove the real running app in a real Chrome tab (not a mockup): generated real content through the wizard (Steps 1-6), and captured Instagram showing grayed-out "On standby" with no Connect button at both Step 2 (quick-select) and Step 6 (publish grid). 

### 3. Explained the Facebook "always connected" mechanism
User asked why Facebook always shows connected. Answer (verified live, not theoretical): `/api/facebook/status` does a real live call to `graph.facebook.com` every time, not a cached read; the vault token is long-lived (~60 days); the self-heal fallback (`getAnyFacebookAuth`) means it shows connected regardless of which browser/tab/cookie state is asking, because it reads server state, not client state. It only changes on: an explicit Disconnect click, a genuine Facebook-side revocation, or the vault file being touched directly. (Shortly after this explanation, the user did click Disconnect - see status table above - which is the correctly-designed way this state changes.)

### 4. WhatsApp: dedicated Meta app + webhook + now prod credentials live, but Groups blocked by OBA (verified 2026-09-14)
User created a **separate, new Meta app specifically for WhatsApp** (Use case: "Connect on WhatsApp") - **App ID `1106218455080416`**, distinct from "SPif" (`1498999398603391`, used for Facebook/Instagram/Canva). This is fine architecturally: WhatsApp messaging only needs its own access token + phone-number-ID + WABA-ID, it doesn't need to share an app with Facebook Login.

Confirmed on this new app (up to 2026-09-13):
- `whatsapp_business_management` and `whatsapp_business_messaging` permissions both show **"Ready for testing"** already (0 API calls) - correctly matches Meta's documented requirement for the Groups API.
- Phone number registered, payment added for business-initiated messages (both showed ✅ complete in "Step 2. Production setup").
- **Webhook registered and verified for real**: pasted Callback URL `https://socialpulse.dotstark.tech/api/whatsapp/webhook` + the real `WHATSAPP_VERIFY_TOKEN` from `.env.local` into the App Dashboard's "Configure Webhooks" panel, clicked "Verify and save" - confirmed via live server log: a genuine `GET` from Meta's servers with `hub.mode=subscribe` and the correct verify token, app responded `200` in 113ms. This is a real, working webhook subscription now, not just locally-tested handshake logic.

**Live blocker corrected:** test number IDs `132753521702128`/`925342073983299` (`+1 (555) 204-8434`) are not OBA-eligible - redirected to "Step 2. Production setup" to use real registered number.

**Update 2026-09-14 — credentials now SAVED + live-verified (no values logged):**
- `.env.local:51-53` now `SET` (16 chars Phone ID, 16 chars WABA ID, 204 chars System User token — sanitized check only) + restart `next dev -p 3001` (pid 35089) → `GET /api/whatsapp/status` → `connected:true` `+91 95214 33306 Dotstark Technologies GREEN`.
- Live Graph checks: `GET /{phoneId}?fields=official_business_account` → `oba_status: NOT_STARTED` ; `GET /{WABA_ID}` → `4439243576313653 Dotstark`; `GET /{businessId 4454812054836168}?fields=verification_status,created_time` → `verified, 2026-09-03T11:52:54+0000` (11 days old → fails 30-day OBA rule, earliest ~2026-10-03).
- **Groups pre-flight live probe:** `POST /{phoneId}/groups` (`SocialPulse Test Group`) → `400 #131215 This phone number is not eligible to access Groups APIs` (`OAuthException` via `client.ts:20` → `WHATSAPP_AUTH_EXPIRED`). Also `GET /{phoneId}/groups?limit=5` → `200 {"data":[]}` (list works, create is OBA-gated). **Result: webhook/1:1 messaging works now, Groups API blocked until OBA `APPROVED`.**

**Still needed for Groups:**
1. Enable two-step verification on `+91 95214 33306` (`WhatsApp Manager → Settings → Two-step verification` — cannot verify via API, must check UI toggle).
2. Wait until ~2026-10-03 for 30-day tenure, then **Request OBA:** `WhatsApp Manager → Phone Numbers → Settings → Request Official Business Account` (or API `POST /{phoneId}/request_official_business_account`). Then `oba_status` flips `NOT_STARTED → IN_REVIEW → APPROVED`; only then will `POST /groups` succeed.
3. Webhook group fields `group_lifecycle_update`/`group_participants_update`/`group_settings_update`/`group_status_update` — `GET /{WABA_ID}/subscribed_apps` shows app subscribed, but field-level needs `App Dashboard → WhatsApp → Configuration → Webhooks → WABA → Manage` — check all 4 before first lifecycle event.

## Carousel feature (added 2026-09-13, uncommitted working tree)

Swipeable multi-image posts (2–9 slides, image-only, numbered swipe order) for all three platforms, two build modes:

- **Manual:** Step 4 "🎠 Carousel" section — toggle Single/Carousel, tap gallery images to add slides, ‹ › reorder, × remove.
- **Generate N slides:** count stepper (2–9) + button; runs the normal single-image background-job N times with per-slide prompt variations, slides append to the gallery AND auto-select in swipe order. Stops on first failure, keeps successes.
- **Step 5:** swipe preview (one slide at a time, arrows + dots + `n/N` counter) when carousel mode is on; grid otherwise.
- **Step 6:** carousel readiness banner; publish/schedule blocked until 2+ image slides.
- **Publish:** LinkedIn (≤9 images) and Facebook (multi-photo `attached_media`) needed no backend change — carousel order flows through the existing `mediaList`/`mediaUrls`. Instagram got a new CAROUSEL path in `instagram/publish/route.ts` (child containers with `is_carousel_item:true` → `CAROUSEL` parent → publish); rejects video carousels and `data:` URLs with clear codes (`INSTAGRAM_CAROUSEL_VIDEO`, `INSTAGRAM_MEDIA_UPLOAD_FAILED`).
- **Scheduler:** `isCarousel` persisted + forwarded by `scheduler/check` (verified live: POST round-trip stores `isCarousel:true` with ordered `mediaList`).
- Removing/clearing gallery media auto-prunes the slide selection. `tsc` clean; lint shows only the pre-existing `react-hooks/refs` + `no-img-element` noise classes (counts grew because the new UI follows the same `p.*`/`img` patterns, no new error classes).

## Step 4 redesign (2026-09-13, uncommitted working tree)

"Media & Branding" re-skinned as a SaaS workspace, frontend-only (all `/api/*` routes and the `mediaItems` flow untouched):

- Title row (subtitle + Save Draft + engagement helper card), Add Media card (dropzone + Upload + purple Generate AI Image + `n/9` pill).
- Recent Media gallery: filter chips (All / AI Generated / Uploaded / Canva / Branded — source derived from item `name`), cards with source badge + filename + probed dimensions + ⋯ menu (cover / Canva edit / logo / vary / add-to-carousel / remove), purple selected state, Add More tile. Canva imports appear as "Canva Edited" and are carousel-eligible.
- Featured "Design with Canva" card (pale blue→lavender gradient, CSS-only preview collage): Create / Edit Selected (enabled only with an image selected, falls back to first image) / Import (● when ready).
- Carousel card: segmented Single/Carousel toggle, horizontal numbered strip with true drag-to-reorder (new `reorderCarouselSlide`), per-slide ⋯ menu (floating, viewport-positioned so the scrolling strip can't clip it), Add Slide tile + picker, compact AI-slides row.
- Branding card: Brand Logo (preview + Change/Remove via new `clearLogo`) / Brand Colors (swatches + add, visual selection) / Brand Fonts (heading/body dropdowns, visual) + "Apply to All Slides" (existing `applyLogoToAllMedia`) + preserved position readout/target note/Adjust entry. New `setMediaCover` helper backs "Set as cover".

## Facebook Login for Business — `config_id` flow (from a prior session, still fully intact)

**Root cause of the old "Invalid Scopes" saga:** the "SPif" Meta app uses Facebook Login for Business, which does not accept Instagram/business-asset permissions as a raw `scope=` string at all (regardless of naming or "Ready for testing" status shown elsewhere) - it requires a Login Configuration (`config_id`).

**Configuration:** "SocialPulse Instagram Publishing", User access token (not System-user), permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_business_basic`, `instagram_business_content_publish`.

**Config ID:** `1058584533638121` (stored as `FACEBOOK_LOGIN_CONFIG_ID` in `.env.local`). `facebook/auth/route.ts` builds the OAuth URL with `config_id=` and no `scope=` param.

**Do not revert this to a `scope=` list.**

## Instagram integration (built in a prior session, currently on standby, UI-verified live this session)

Design: Instagram has no login of its own - a publishable account is a Business/Creator account linked to a Facebook Page, published to using that Page's own access token.

- `facebook/vault.ts` — `FacebookPageEntry` optionally carries `instagramAccountId`/`instagramUsername`; `getInstagramAccount(userId, pageId?)` resolves it.
- `facebook/callback/route.ts` — fetches each Page's `instagram_business_account` field + `@username`.
- `instagram/auth`, `instagram/callback` — redirect to `facebook/auth`. Old Instagram Basic Display API code (dead since Dec 2024, read-only even before that) is gone.
- `instagram/status/route.ts` — returns `{connected:false, reason:'NO_LINKED_INSTAGRAM_ACCOUNT'}` when Facebook is connected but no Page has Instagram linked.
- `instagram/publish/route.ts` — uses `graph.facebook.com/v21.0/{ig-user-id}/media` → `/media_publish` with the Page's token, resolved server-side.
- `instagram/disconnect/route.ts` — no-op success (nothing separate to revoke).
- **UI: on standby** (grayed out, "On standby" label, not selectable) at the user's explicit request - confirmed via live browser test this session, still correct.

**Known real limitation, unchanged:** Instagram's Graph API requires a publicly reachable media URL - it cannot accept the `data:` URLs this app generates/uploads. Still an open item once Instagram comes off standby.

## Bugs found and fixed in prior sessions (kept for reference, all still applied)

1. Facebook/LinkedIn callback redirect broke behind the tunnel (`0.0.0.0` baked into `request.url`) - fixed via `*_REDIRECT_URI`-derived origin.
2. Facebook had no `/api/facebook/status` route - added, mirrors `linkedin/status`.
3. Self-heal checks only worked with a cached `userId` - added `getAnyFacebookAuth()`/`getAnyLinkedInToken()` fallbacks; fixed a structural bug where checks were skipped entirely on a fully empty `localStorage`.
4. LinkedIn token got deleted by a false alarm (status routes deleted the vault token on ANY non-200, not just genuine `401`) - hardened to only delete on real `401`.
5. `generate-image` could time out through the public Cloudflare tunnel - converted to background-job + polling. Scenarios 1/2 still use the old single-long-request model and have the same latent exposure - not converted yet.
6. Real publish tests (LinkedIn + Facebook) both succeeded end-to-end on real accounts in an earlier session.

## Model Mapping - Current

### Scenario 1: text-only prompt to content
Route: `src/app/api/generate-content/route.ts`. **Provider: Mercury 2.5 primary (`https://api.inceptionlabs.ai/v1`, `mercury-2.5`, `reasoning_effort: low`, key `sk_b59bfa…1`) → Nemotron 3.5 Lightning fallback (`https://integrate.api.nvidia.com/v1`, `nvidia/nemotron-3.5-lightning-30b-a3b`)** for every scenario + import-equivalent text path; `INCEPTION_*` env at `.env.local:10-13`, timeout `120_000ms`. Mercury is diffusion-parallel and fast (1–1.2s observed locally, 2026-09-13; Nemotron fallback 7–8s when forced via `__FORCE_MERCURY_FAIL__` test hook at `route.ts:147-151`). Not converted to background-job/polling, still exposed to the Cloudflare-tunnel-timeout class — Mercury's speed makes this far less likely now. **Verified 2026-09-13: direct Inception API 200 (diffusion model query), Mercury primary `POST /api/generate-content` 200 in 1196ms, forced Mercury 503 → Nemotron fallback 200 in 7.9s (live), plus multi-platform import-like payloads. Verified 2026-09-14: server still on Mercury (pid 35089) serving.**

### Scenario 2: image/reference upload to content
Route: same file. Vision model `meta/llama-3.2-11b-vision-instruct`. Two-step fallback + `withVisionRetry`, `sharp`-based normalization. **Text step after vision now also Mercury → Nemotron** (same fallback chain as Scenario 1). Not converted to background-job/polling, ~70-130s observed total. **Re-verified working this session** after isolating one transient external NVIDIA 500 (confirmed not a code bug via log inspection, retest with a real image passed cleanly).

### LinkedIn Company Page (new 2026-09-14)
App `SocialPulse` (`77rasmesovzky9`) + Page `Dotstark Technologies` (`Verified: Sep 7, 2026`) — `Settings → Privacy Policy URL` now `https://socialpulse.dotstark.tech/privacy` (`src/app/privacy/page.tsx:1` → `200` local+public) and logo set. **But** `Products > Community Management API` still grey `Development Tier → Request access` (screenshot 2026-09-14) — partner-gated, not unlocked by privacy alone. `Auth → OAuth 2.0 scopes` shows only `openid profile w_member_social email` (personal `urn:li:person` works, org `w_organization_social` will `invalid_scope` until `Community Management API → Added`). `Privacy` page is policy-only, no token logic.

### WhatsApp Groups OBA (new 2026-09-14, verified live, no UI built yet)
Routes exist (`status`/`groups`/`[groupId]`/`invite-link`/`message`/`participants`/`send-message`/`webhook` + `client.ts` `v21.0`) — no speculative UI per your rule. Live state: `connected:true` (`+91 95214 33306` `1288066011058334` / WABA `4439243576313653` business `4454812054836168 verified 2026-09-03`) — but `oba_status: NOT_STARTED` → `POST /groups` → `400 #131215` (Groups only for OBA). 2FA cannot be verified via API (must check Manager toggle), 30-day tenure fails (11 days → earliest 2026-10-03), webhook group fields need `Dashboard → WhatsApp → Configuration → Webhooks → WABA → Manage` check. Alternate without waiting: manual group + invite-share via existing `send-message`/`invite-link` (hybrid) or 1:1 broadcast simulation (existing routes).

### Scenario 3: text prompt to image
Route: `src/app/api/generate-image/route.ts`. Provider `https://gen.pollinations.ai/v1/images/generations`, model `gpt-image-2`. Background-job + polling (fixed previously). **Re-verified working this session**, twice, full `pending`→`done` cycle each time.

## OpenCode Notes
Not currently used for Scenario 1 (NVIDIA is active). Paid `muse-spark-1.3`: billing error. Free `muse-spark-1.3-contributor-free`: `429 FreeUsageLimitError`. Leave env values in place unless cleaning up intentionally.

## Uncommitted this session

```
 M .gitignore
 M PULLOVER_OG.md
 M src/app/api/facebook/auth/route.ts
 M src/app/api/facebook/callback/route.ts
 M src/app/api/facebook/vault.ts
 M src/app/api/generate-content/route.ts
 M src/app/api/generate-image/route.ts
 M src/app/api/instagram/auth/route.ts
 M src/app/api/instagram/callback/route.ts
 M src/app/api/instagram/publish/route.ts
 M src/app/api/linkedin/callback/route.ts
 M src/app/api/linkedin/vault.ts
 M src/app/page.tsx
 M src/app/privacy/page.tsx
 M src/app/studio-wizard.tsx
 M src/app/studio-workspace.tsx
?? src/app/api/facebook/status/
?? src/app/api/instagram/disconnect/
?? src/app/api/instagram/status/
?? src/app/api/linkedin/status/
?? src/app/api/whatsapp/
```

`npx tsc --noEmit` passes clean (re-confirmed 2026-09-14: Mercury `route.ts:40-72` + `callMercury` + `privacy/page.tsx`). Lint: previously 185 problems on baseline (all `react-hooks/refs` + `no-img-element` noise), not re-diffed this micro-session. Next dev now **35089** (Mercury+WhatsApp env).

## Git / Local Files

- `.env.local` — now holds `WHATSAPP_PHONE_NUMBER_ID` (16 chars, `1288066011058334`), `WHATSAPP_BUSINESS_ACCOUNT_ID` (`4439243576313653`), `WHATSAPP_ACCESS_TOKEN` (204 chars System User, test) — all `SET` sanitized, plus `WHATSAPP_VERIFY_TOKEN` (`de37db...`), `INCEPTION_API_KEY` (`sk_b59b…1`, `mercury-2.5` primary), `LINKEDIN_*`/`FACEBOOK_*`/`CANVA_*` — never log values. Restart required after edit (done → pid 35089).
- `linkedin-tokens.json` — `{"linkedin":{}}`, empty. `facebook-tokens.json` — `{"facebook":{}}`, empty (disconnected). `canva-sessions.json`, `whatsapp-events.log` (`2026-09-12 test event` only, no Group lifecycle yet) — local, gitignored.
- `scheduled-posts.json` — tracked, may contain accumulated local history; inspect before committing.
- `src/app/privacy/page.tsx` — new, public `200`, LinkedIn expects `https://socialpulse.dotstark.tech/privacy`.

## Known Issues / Gotchas
- Facebook's OAuth uses `config_id` (Facebook Login for Business), not `scope=` - do not revert.
- A stale, already-loaded Facebook OAuth dialog tab can replay an OLD request even after the app's code has moved on - if a "fixed" error reappears, check whether it's a genuinely fresh request first.
- **WhatsApp test number vs. production number**: Meta's dashboard shows a free test number's Phone Number ID/WABA ID prominently on "Step 1. Try it out" - these are NOT usable for OBA-gated features like Groups API. Always confirm which number's IDs are being used before wiring them into `.env.local`.
- WhatsApp now lives on a **separate Meta app** (`1106218455080416`) from Facebook/Instagram/Canva (`1498999398603391`) - intentional, not a mistake, but worth remembering when debugging either integration so credentials aren't cross-referenced by accident.
- Scenario 1/2 content generation still exposed to the Cloudflare-tunnel-timeout class of bug Scenario 3 had before its fix - not yet converted.
- **LinkedIn Company Page:** `Products > Community Management API` grey is partner-gated (not missing Privacy) — `w_organization_social` will `invalid_scope` until `Added`; keep `w_member_social` only until then or `Auth` breaks.
- **WhatsApp Groups:** `400 #131215` persists until `oba_status: APPROVED` (`GET /{phoneId}?fields=official_business_account`). Prerequisites: `NOT_STARTED` now, **<30 days** (`business 2026-09-03` → earliest 2026-10-03) + 2FA must be ON in Manager (`Two-step verification` toggle — not verifiable via this token) + `group_*` webhook fields must be `Manage` checked.

## Recommended Next Step (updated 2026-09-15)

1. **Meta WhatsApp OBA path — do not retry `POST /{phoneId}/groups` until** `GET /{phoneId}?fields=official_business_account` flips `NOT_STARTED → APPROVED`. Poll that field only. This is irrelevant to Whapi existing-group flow which already works.
2. **Whapi existing-group flow is live:** `https://socialpulse.dotstark.tech/api/whapi/webhook` is ready for Whapi dashboard (messages.post/statuses.post). Set Whapi panel → Webhook URL to that value, enable `messages.post` + `statuses.post` (later add groups/communities events when needed). No token in browser, `WHAPI_API_TOKEN` stays server-only.
3. **LinkedIn Company Page:** apply **Partner Program** for `Community Management API` (`Products → Request` now grey, plus `Auth` scopes only `w_member_social`). Keep personal `urn:li:person` posting live; once `Products → Added` appears, add `w_organization_social` to `auth/route.ts:7` and reconnect once — org picker (`urn:li:organization`) then works. Test via `urn:li:organization:2414183` (DevTestCo) per docs if needed.
4. Facebook + Instagram already re-connected live (Facebook `Dot Stark`, Instagram `@dotstark_technologies`) — Instagram still on standby UI by user choice; flip `studio-wizard.tsx` flags when ready. Instagram public-media-hosting step still required (dataURLs staged in `.instagram-media/` need public URLs).
5. Consider applying the background-job/polling conversion to Scenario 1/2 content generation (still long synchronous, exposed to Cloudflare `100s`).
6. Whapi scheduler: if scheduled WhatsApp group posts are needed, extend `POST /api/scheduler` to store `whapiGroupId` + add `scheduler/check` branch that calls `POST /api/whapi/publish` (reuse `attemptId` guard). Not built yet.
7. ~~Commit this session's (and prior sessions') work once stable checkpoint reached~~ — **done 2026-09-16**: `scheduled-posts.json` inspected (zero embedded `accessToken` values, safe), everything committed in one checkpoint. See the 2026-09-16 handover section above for exactly what shipped in that commit.
8. Reschedule/Cancel/Drafts feature (2026-09-16) still needs a real browser click-through — the Chrome extension wasn't available this session, so it was only verified via direct API calls plus the user's own live screenshots. Confirm the Reschedule/Cancel modals and the new `PillButton`/`Btn` styling actually render and behave as intended end-to-end.
