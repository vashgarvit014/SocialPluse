# PULLOVER - SocialPulse live tunnel + model state

Updated: 2026-09-10 (fix session: Scenario 1+2 unblocked, all 3 verified 200)

## Real Project

Use this repo:

`/Users/admin/Desktop/ScoialPulse_OG/social-media-manager`

Older docs mention `/Users/admin/Desktop/ALONEai copy/social-media-manager`; that is stale for this machine/session. Do not edit the old path unless the user explicitly asks.

The tree has substantial uncommitted work. Do not run `git checkout .`, `git reset --hard`, or stash/drop casually.

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

## Important Live Config

`next.config.ts` includes:

- `allowedDevOrigins: ['127.0.0.1', 'socialpulse.dotstark.tech']`
- `serverExternalPackages: ['ffmpeg-static']`

This is required because Next dev blocks chunks/HMR from public tunnel hostnames unless allowed.

`.env.local` now points public app/OAuth callback URLs at:

- `NEXT_PUBLIC_APP_URL=https://socialpulse.dotstark.tech`
- `LINKEDIN_REDIRECT_URI=https://socialpulse.dotstark.tech/api/linkedin/callback`
- `CANVA_REDIRECT_URI=https://socialpulse.dotstark.tech/api/canva/callback`

Provider dashboards may still need those public callback URLs registered.

## Cloudflare Setup Done

Completed:

- Installed `cloudflared` with Homebrew.
- Logged into Cloudflare and authorized the `dotstark.tech` zone.
- Created tunnel `socialpulse`.
- Added CNAME route for `socialpulse.dotstark.tech`.
- Verified public URL returns `HTTP/2 200`.

Keep both the Next server and `cloudflared` running for the public URL to work.

## Model Mapping - Current

### Scenario 1: text-only prompt to content

Route: `src/app/api/generate-content/route.ts`

Provider:

`https://integrate.api.nvidia.com/v1`

Code derives:

`/chat/completions`

Current models (Nemotron primary per user request, 2026-09-10):

- Primary: `nvidia/nemotron-3.5-lightning-30b-a3b` (route test: 200 in 56.5s)
- Fallback: `meta/llama-3.2-11b-vision-instruct` (full JSON in ~21-33s)
- Timeout: `120_000ms`

Env variables:

- `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1`
- `NVIDIA_TEXT_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b`
- `NVIDIA_TEXT_FALLBACK_MODEL=meta/llama-3.2-11b-vision-instruct`

Behavior:

- Nemotron primary (user choice): route test `200` in 56.5s, clean
  `JSON.parse`, quality caption. Direct-probe latency varies (12.8s good /
  70s stub) — flaky but functional; Llama fallback covers bad drafts.
- Llama-11b fallback: OK 200 in ~3s ping; full JSON generation ~21-33s.
- DeepSeek removed: timed out on every live + direct call (42s/120s/165s).
- Other models probed 2026-09-10: mistral-7b / nemotron-70b / phi-3.5-moe
  return 404 (not entitled on this key); llama-90b-vision times out.
- `parseAndValidate` now collapses C0 control chars pre-parse and falls back
  to `tolerantParse` (regex-anchored caption/hashtags/image_prompt rescue
  for unescaped quotes). This fixed most "unparseable output" discards.

### Scenario 2: image/reference upload to content

Route: `src/app/api/generate-content/route.ts`

Vision model:

`meta/llama-3.2-11b-vision-instruct`

Flow:

- Direct vision+text call first.
- If invalid/unparseable, analyze image separately.
- Then final caption generation uses NVIDIA text generation.

Known result (fixed 2026-09-10):

- Uploads are normalized server-side (`normalizeImageForVision` in
  `generate-content/route.ts` via `sharp`: resize inside 1024px, JPEG q70,
  small JPEGs pass through). Proven: 544KB PNG -> 47KB JPEG.
  Raw large PNGs made NVIDIA vision return instant HTTP 500 — do not remove.
- `sharp@0.35.3` added to `package.json` deps + `serverExternalPackages`.
- Vision direct `max_tokens` raised 1200 -> 2000 (outputs were cut mid-JSON).
- Two-step analysis wrapped in `withVisionRetry` (was defined but unused);
  NVIDIA vision 500s transiently and one retry usually succeeds.
- Two-step text stage gets one strict-JSON retry on unparseable drafts.

### Scenario 3: text prompt to image

Route: `src/app/api/generate-image/route.ts`

Provider:

`https://gen.pollinations.ai/v1/images/generations`

Model:

`gpt-image-2`

Behavior:

- Deliberately no fallback and no timeout.
- Last live test succeeded: `HTTP 200`, valid JPEG data URL, around 70s.
- Safety-filter failures return `IMAGE_SAFETY_BLOCKED`.

## OpenCode Notes

OpenCode was tested but is not currently used for Scenario 1 after switching back to NVIDIA.

Findings:

- Paid model ID: `muse-spark-1.3`
  - Returned billing/payment error for the provided key.
- Free contributor model ID: `muse-spark-1.3-contributor-free`
  - Returned `429 FreeUsageLimitError`, rate limit exceeded.
- `muse-spark-1.3-contributor` is not supported by the API.

Leave OpenCode env values in `.env.local` unless cleaning up intentionally, but the active Scenario 1 route uses NVIDIA.

## Current Test Results

Validated:

```bash
npx tsc --noEmit
```

passes.

Public URL:

```bash
curl -I https://socialpulse.dotstark.tech
```

returns `HTTP/2 200`.

Scenario 1 live test (re-run 2026-09-10 after fix):

```bash
POST http://127.0.0.1:3001/api/generate-content
```

Result (Nemotron primary, 2026-09-10):

`200` in 56.5s, valid caption + 10 hashtags + image_prompt, parsed on first
attempt. Server log: `[NVIDIA:nvidia/nemotron-3.5-lightning-30b-a3b]
content: 1122 chars`. (One quirk: model emitted off-topic `#futureoffood`.)
Server log confirms primary model is now
`nvidia/nemotron-3.5-lightning-30b-a3b`.

Scenario 2 live test (re-run 2026-09-10 after fix, same 556KB PNG that 500'd):

`POST /api/generate-content` with `hasImage:true`

Result:

`200` in ~70s, image-grounded caption ("coding environment... dark gray
background..."), 10 hashtags, via two-step + tolerant-parse rescue.
Note: ~70-130s total exceeds Cloudflare's ~100s budget — public-URL image
requests can still 524. Long-term fix is background job + polling.

Scenario 3 live test:

`POST /api/generate-image`

Result:

`200`, model `gpt-image-2`, valid JPEG data URL.

## Other Product State

### Canva

- Full Canva Connect API integration exists.
- OAuth2 + PKCE, server-side `canva-sessions.json`.
- Token cookies are httpOnly.
- Public callback env now points to `https://socialpulse.dotstark.tech/api/canva/callback`.
- Need to ensure Canva developer portal has public callback/return URLs if testing Canva on public domain.

### LinkedIn

- Server-side token vault: `linkedin-tokens.json`.
- Manual connect only; no auto-restore status route.
- Generate Content is selection-only; publishing/scheduling require connection.
- Public callback env now points to `https://socialpulse.dotstark.tech/api/linkedin/callback`.
- Need LinkedIn dashboard callback URL registered before public OAuth will work.

### Facebook

- Page integration exists but remains in-progress.
- `facebook-tokens.json` is now gitignored.
- Needs Meta app setup/permissions before real use.

## Git / Local Files

Important gitignored local state:

- `.env.local`
- `linkedin-tokens.json`
- `facebook-tokens.json`
- `canva-sessions.json`
- `.next/`
- `node_modules/`

`scheduled-posts.json` is tracked and may contain accumulated local history; inspect before committing.

## Known Issues / Gotchas

- `npm run lint` currently fails with many existing React Compiler lint complaints, especially in `page.tsx` and `studio-wizard.tsx`.
- `npx tsc --noEmit` is the current practical verification gate and passes.
- If Next fails with missing SWC binary, restore/install `@next/swc-darwin-arm64@16.3.2`. In this session the binary was restored from an npm tarball.
- If public tunnel UI loads HTML but JS chunks fail, check `allowedDevOrigins`.
- If public requests run past Cloudflare limits, avoid retrying long model calls inside one HTTP request.

## Recommended Next Step

Scenario 1/2 now work locally (all 3 verified 200 on 2026-09-10). Remaining:

1. Scenario 2 over the public URL can still hit Cloudflare's ~100s limit
   (70-130s chains) — convert content generation to a background job with
   polling if public image posts matter.
2. `npm run lint` still has the pre-existing React Compiler noise; `tsc` is green.
3. `scheduled-posts.json` is tracked with local history — inspect before committing.
4. Commit this session: model swap + vision normalize/retry/tolerant-parse
   (`route.ts`, `.env.local`, `package.json`, `next.config.ts`, `PULLOVER_OG.md`).
