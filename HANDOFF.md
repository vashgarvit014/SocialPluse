# Session Handoff — SocialPulse / social-media-manager

Read this first if you're picking this project up in a new session. Written 2026-09-09.

## ⚠️ There are TWO copies of this project on disk — this is the real one

- **`/Users/admin/Desktop/ALONEai copy/social-media-manager`** ← you are here. This is the one that actually runs, the one with all working features, and the one registered with the live Canva integration.
- `/Users/admin/Desktop/ALONEai/social-media-manager` (no "copy") — an older, less-developed duplicate. It has a *different, earlier, now-abandoned* Canva implementation (the Canva Button SDK, which turned out to be China-only and unusable — don't resurrect it). Nothing points to it. Treat it as dead unless the user says otherwise; don't assume it's in sync with anything described below.

**Always confirm which directory you're in before editing.** If a `next-server` process is unexpectedly serving stale behavior, check `lsof -iTCP:3001 -sTCP:LISTEN -P` and `lsof -p <pid> | grep cwd` to see which directory it's actually running from — this exact confusion cost a lot of debugging time this session.

## How to run it

```
cd "/Users/admin/Desktop/ALONEai copy/social-media-manager"
npm run dev          # next dev -p 3001 -H 0.0.0.0
```

- Runs on **port 3001**, not 3000 (something else already held 3000 on this machine).
- Access via **`http://127.0.0.1:3001`** — not `localhost`. Canva's OAuth requires an IP literal for local redirect URIs; the app's `CANVA_REDIRECT_URI` and the Canva developer portal's registered callback/return URLs are both set to `127.0.0.1:3001`. Using `localhost:3001` instead will break the Canva flow (LinkedIn doesn't care either way).
- **Never run `npm start` / `next start` in this directory while also developing.** It silently takes over the port with a stale compiled build that doesn't hot-reload — a `next start` process shadowing the dev server on port 3001 was the actual cause of a long, confusing "my fix isn't working" debugging session. If port 3001 ever serves something that doesn't match the source, check `ps aux | grep next` for a stray `next-server` process and kill it, then restart `next dev`.
- No `next build` is required for local dev/testing — only run it if you need to sanity-check the production build compiles (I did this repeatedly this session as a lint/typecheck gate, not to actually serve from it).

## What's implemented and working

### Canva Connect API integration (built this session)
Full OAuth2 + PKCE integration — **not** the Canva Button SDK (that's China-only, deliberately not used). Files:
- `src/lib/canva.ts` — all Canva API helpers, PKCE, token refresh, structured `CanvaError` codes, session store helpers.
- `src/app/api/canva/auth/route.ts` — starts OAuth. **Important design point:** the PKCE `code_verifier` is stored server-side keyed by `state` (in `canva-sessions.json`), *not* in a cookie — cookies set right before redirecting to Canva didn't reliably survive the `127.0.0.1 → canva.com → 127.0.0.1` cross-site hop in real browser testing (this was a real, reproduced bug, not a hypothetical). Don't revert this to cookie-based PKCE storage without re-testing carefully.
- `src/app/api/canva/callback/route.ts` — token exchange, sets httpOnly cookies (`canva_access_token`, `canva_refresh_token`, `canva_expires_at`) — token never reaches the browser/localStorage.
- `src/app/api/canva/status/route.ts` — real server-computed connection status (checks/refreshes token). Frontend calls this on mount rather than trusting a client flag.
- `src/app/api/canva/disconnect/route.ts` — actually deletes the token cookies.
- `src/app/api/canva/create-design/route.ts` — uploads current image as a Canva asset, creates a design sized to the app's own `aspectRatioMap[aspectRatio]`, returns `edit_url`.
- `src/app/content-studio/route.ts` — this path is registered as the integration's **Return URL** in the Canva developer portal (already configured there — don't change without updating the portal too). It just relays to:
- `src/app/api/canva/return/route.ts` — verifies the `correlation_jwt` against Canva's JWKS (`jose` package), marks the design "ready" — **does not auto-export**.
- `src/app/api/canva/export/route.ts` — the explicit "Import from Canva" step; only runs on that button click, exports PNG, returns it inline. Pushed into `mediaItems[]` as a **new** item, never overwrites `generatedImage`.

Env vars (already in `.env.local`, real values, not placeholders):
```
CANVA_CLIENT_ID=OC-AaCEan4muRu4
CANVA_CLIENT_SECRET=<real secret, already set>
CANVA_REDIRECT_URI=http://127.0.0.1:3001/api/canva/callback
```
Scopes requested (must match what's enabled in the Canva developer portal — don't add more): `asset:read asset:write design:content:read design:content:write design:meta:read profile:read`.

**Status: OAuth connect verified working end-to-end** (connected as "Dev Dotstark" during this session). **Not yet tested: a full real Edit-in-Canva → manual edit → Import-from-Canva round trip with an actual image** — the connect step was verified, but the user hadn't generated a usable image yet by the time this session ended (kept hitting an Azure content-safety rejection on a test/gibberish prompt — see below, unrelated to Canva).

### LinkedIn
Already existed before this session, pre-dating my involvement — server-side token vault (`src/app/api/linkedin/vault.ts` → `linkedin-tokens.json`, gitignored), OAuth via `linkedin/auth` + `linkedin/callback`, publish via `linkedin/publish` (structured error codes, attempt-id de-dup, no text-only fallback if media upload fails), and a real `linkedin/disconnect` that scrubs tokens.

**This session's change:** removed a deliberate "standby" bypass that let content generation proceed without an actually-connected platform (it silently defaulted to `['linkedin']`). Now `generateContent()` in `page.tsx` requires a real selected+connected platform, and the wizard's Platform badge in Step 2 shows **"Active"** (green) vs **"Connect to continue"** (amber) based on real connection state, not a hardcoded label.

**Status: OAuth connect verified working end-to-end** (connected as "Jai Luhach" during this session, token confirmed present in `linkedin-tokens.json`). **Real publish (posting to their actual public LinkedIn profile) was deliberately never triggered by me** — that's outward-facing and irreversible, so I didn't test it without explicit go-ahead. Route code was reviewed and looks structurally sound, but hasn't been exercised end-to-end by anyone this session.

### Image generation
`src/app/api/generate-image/route.ts` uses only `gpt-image-2` via Pollinations, **deliberately no fallback model and no timeout** — there's a comment in the code (`// Only model — no fallback, no timeout limit (user requested)`) marking this as an intentional prior decision. Don't "fix" this by re-adding a fallback without asking first.

A real failure was hit this session: Azure's content-safety system (which backs `gpt-image-2`) rejected a prompt derived from gibberish test input (`"bhuib"`), returning a 400 the app correctly surfaces as a clear error. Not a bug — try a real prompt instead.

## Known pre-existing issues (not touched, not introduced by me)
- `studio-wizard.tsx` has ~140 pre-existing `eslint` `react-hooks/refs` ("Cannot access ref value during render") errors — a false-positive from the React Compiler lint rule reacting to the shared `p` props object (which also carries file-input refs). Confirmed via `git stash` diffing that this count doesn't change because of anything I added — it's baked into the file already. `tsc` and `next build` are both clean; this is lint noise, not a runtime bug.
- `src/app/api/ffmpeg/logo/route.ts` triggers a Turbopack build warning about filesystem tracing (`child_process.spawn(ffmpegPath, ...)`). Pre-existing, unrelated to anything this session touched.
- `README.md` and `.env.example` (in the *other*, non-copy directory) are stale relative to the real code — not fixed, out of scope so far.

## Local data files (gitignored, machine-specific)
- `linkedin-tokens.json` — LinkedIn OAuth token vault.
- `canva-sessions.json` — Canva PKCE/correlation-state handoffs, now also gitignored.
- `scheduled-posts.json` — tracked in git currently (has real accumulated post history in it — check before committing).

## Nothing has been committed this session
`git status` shows everything above as uncommitted (modified + untracked). Don't `git checkout .` or `git stash drop` casually — that would discard all of this work, including the entire Canva integration.

## Suggested next steps
1. Generate a real image (a real topic, not test gibberish), then run the full Edit in Canva → edit → Return → Import from Canva loop end-to-end for the first time.
2. When the user is ready, do one real LinkedIn publish test (with their explicit go-ahead — it posts publicly).
3. Decide what to do with the stale `ALONEai/social-media-manager` (non-copy) directory — currently just sitting there with dead code.
4. Consider committing this session's work once it's been manually verified — it's substantial and currently only lives in the working tree.
