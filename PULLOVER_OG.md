# PULLOVER - SocialPulse live tunnel + model state

Updated: 2026-09-17, WhatsApp picker/disconnect/QR-auto-connect implementation (committed c8fc8fe) + Whapi token rotation to channel SPRWMN-GHHP9. See CURRENT HANDOVER below.

## CURRENT HANDOVER — authoritative; supersedes historical sections below

### Latest implementation handover (2026-09-17 — WhatsApp picker + disconnect + QR auto-connect)

Committed as `c8fc8fe` (3 files, +168/−27): `src/app/page.tsx`, `src/app/studio-wizard.tsx`, `src/app/studio-workspace.tsx`. `tsc --noEmit` clean after every step; local + public `/` `200`; no posts sent.

**1. Picker shows Communities + All groups (was communities-only).** `loadWhapiGroups` (`page.tsx`) now fetches `GET /api/whatsapp/communities` and paginated `GET /api/whapi/groups?count=500&offset=0` in parallel, reconciles by id, and renders grouped optgroups (`Communities (N)` + `All groups (M)`) in `studio-wizard.tsx`. Labels changed `Community` → `Chat` (`Destination: WhatsApp`, `Select chat`, `No chat selected`); publish/schedule guards reworded the same way, logic unchanged (parent `community` type and <2-participant chats stay `not sendable`).

**2. All-greyed-out regression — diagnosed and fixed same session.** After the user reconnected WhatsApp, Whapi stopped sending `is_parent` flags, so `getWhatsAppCommunities()` fell into its fallback and echoed all 33 regular groups as `announcement_group`; the merge de-duped by id preferring those mislabeled copies and dropped the correctly-typed `/groups` entries — everything piled into "Communities (33)" greyed out. Fix: reconcile trusts `/groups` typing when the communities endpoint is in echo mode (same id+name but regular type there), keeps genuine announcement mappings with best-known count, and recognizes the route's `announcement_group` type value. Verified against live data: `Communities (1)` — SocialPulse Testing🚀 enabled; `All groups (32)` — 27 enabled, only 5 disabled (all genuinely 0/1-member chats). If the picker ever shows all-disabled again, hit `↻` — group metadata shifts across reconnects.

**3. One-click WhatsApp Disconnect.** New `disconnectWhatsApp()` (`page.tsx`) calls existing `POST /api/whatsapp/disconnect`, clears whapi state + group list + selection + QR state, and deselects the platform. Buttons added on the Step 2 platform row (toggles Connect ↔ Disconnect) and the Step 6 publish-card header. Also added the previously-missing row-level Disconnect for LinkedIn/Facebook/Instagram on Step 2 (they showed nothing once connected).

**4. QR modal self-resolves on scan.** While the connect modal is open and not connected, client polls `GET /api/whatsapp/status` every 3s (same endpoint the old button used; skips hidden tabs, no overlapping ticks) and on `connected:true` sets state, closes the modal, toasts success, and reloads the chat list. Dedicated **Check Status button removed** (auto path live-verified); `Refresh QR` kept (QR expiry is separate). Status endpoint live-curled `{"connected":true}` as the poll's resolve condition.

**5. Token rotation (user-supplied).** `WHAPI_API_TOKEN` → `yP1YwUS…` (`.env.local:63`, server-only, gitignored — never committed) → new channel `SPRWMN-GHHP9` `AUTH` (`GET /api/whapi/status` `200 connected:true`). Server restarted to load env: `next dev -p 3001 -H 0.0.0.0` + `cloudflared tunnel socialpulse`, local + public `200`. Note: channel currently syncs **33 groups** (was 100–166 before the reconnect) — Whapi resync state, not an app bug; counts will settle as sync completes.

**Still needs a human eye:** picker grouping, Disconnect buttons, and QR self-close were verified via `tsc` + live endpoint curls, not a real browser pass — confirm visually on `https://socialpulse.dotstark.tech`.

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
