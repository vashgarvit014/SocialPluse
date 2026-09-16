# SocialPulse UX implementation report

Updated 2026-09-14. This report covers the requested UX changes, not every pre-existing uncommitted file in the repository. No live posts were sent and no existing scheduled-post database was replaced during tests.

## 1. Files changed and existing owners

Before implementation, the existing owners were inspected: `page.tsx` owned scheduled post lists, legacy local drafts, planner/calendar, media and publish orchestration; `studio-wizard.tsx` and `studio-workspace.tsx` owned wizard controls; scheduler routes owned JSON persistence and manual due-post checking; each provider's auth/callback/publish routes owned its integration. Canva also used `canva-return/page.tsx`. These owners were extended rather than rebuilt.

Changed for this request:

- `src/app/page.tsx`, `src/app/studio-wizard.tsx`, `src/app/studio-workspace.tsx`, `src/app/canva-return/page.tsx`.
- `src/app/api/scheduler/route.ts`, `src/app/api/scheduler/check/route.ts`.
- Auth and callback `route.ts` files under `src/app/api/linkedin/`, `facebook/`, and `canva/`.
- `src/app/api/facebook/publish/route.ts`, `src/app/api/instagram/publish/route.ts`.
- `PULLOVER_OG.md` and this report.

Added:

- `src/lib/posts.ts`, `post-store.ts`, `alt-capabilities.ts`, `editor-return.ts`, `oauth-return.ts`.
- `src/app/post-preview.tsx`, `src/app/oauth-return/page.tsx`.
- `src/app/api/connect/[platform]/route.ts`, `src/app/api/media/alt/route.ts`.
- `tests/product-flow.cjs`, `tests/editor-browser.cjs`.

Other dirty files include earlier Instagram/WhatsApp/configuration work. They were not reset or claimed as newly implemented here.

## 2. Schedule cancellation

Cancel asks “Cancel this scheduled post?” and preserves the record. It sets `status: draft`, `scheduledAt: null`, and fresh `cancelledAt`/`updatedAt`, retaining content, media/order, platform content, branding, ALT, and the editor snapshot. The success toast is “Schedule cancelled. Post moved to Drafts.” with View Draft. A publishing or published record cannot be cancelled. Saving an edited scheduled item as a draft also confirms cancellation.

## 3. Draft persistence and ordering

Full manual drafts and cancelled schedules use the existing `scheduled-posts.json` store. Optional fields remain backward-compatible. Legacy local drafts and legacy cancelled records remain readable without destructive migration. Drafts sort by `updatedAt`, falling back to `createdAt`, newest first. Cards offer Preview, Edit, Schedule Again, and confirmed Delete. Full snapshots preserve editor-specific fields. Editing/rescheduling a persisted draft keeps its ID; an old local-only draft is saved as a new full record without deleting the original.

Writes use temporary files and atomic rename. Corrupted JSON produces an error rather than an empty database overwrite. This remains a single-process local JSON design, not a multi-instance database.

## 4. Preview-first planner

Preview is the default planner view, with Calendar and Timeline retained. Cards show media, carousel slide navigation, full caption and platform-specific content, platforms, schedule, timestamps/source, and per-image ALT status. Cancelled drafts are excluded from scheduled views. Image/video previews tolerate old records missing new fields.

## 5. ALT model

`MediaItem` and stored post media accept optional `altText`. Each carousel item owns its description, including repeated image URLs with different descriptions. Generated, uploaded, Canva, branded, and variation media use the same controls. ALT can be edited, cleared, saved, restored, and previewed. The final publish step lists added/missing ALT and supports generating missing descriptions; publishing with missing ALT prompts a warning.

## 6. ALT generation

The new endpoint sends the actual image pixels to NVIDIA's vision model using the existing API configuration. Sharp normalizes supported uploaded/data images to bounded JPEG input. The prompt asks for concise visible-image description rather than repeating the generation prompt. There is a timeout, no hidden retry, and no fabricated fallback. Concurrent manual edits are not overwritten by late responses. Arbitrary remote URLs are rejected by this endpoint; upload the image or enter ALT manually. Real model response quality and account availability still need live verification.

## 7. Platforms receiving ALT via API

- Facebook photo uploads receive `alt_text_custom` for single and carousel photo items. This field is exposed by Meta's official [Page photo SDK definition](https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/adobjects/page.py).
- Instagram image media containers receive `alt_text`, including individual carousel children. This field is exposed by Meta's official [Instagram user media SDK definition](https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/adobjects/iguser.py).

Actual route payloads were tested with network mocks. Live delivery using the configured API version has not been tested. ALT is never appended to visible captions.

## 8. ALT retained only in SocialPulse

The current LinkedIn native-image UGC path, WhatsApp, Canva, video items, and unknown future platforms retain ALT locally. LinkedIn's current path does not map ALT to a visible media description: the [UGC documentation](https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api) distinguishes descriptions from article-thumbnail ALT. No broader claim that LinkedIn never supports ALT is made. A shared capability helper permits only the supported image mappings above.

## 9. OAuth state preservation

Before connecting, a full snapshot is saved in IndexedDB under an opaque identifier. It includes wizard step/tab, text, media/order/selection, carousel, branding/original media, ALT, platforms, schedule, draft ID, and return path. Saving must complete before navigation; failure keeps the editor open. Only the identifier travels in the return flow. A short-lived HttpOnly cookie binds it to the provider OAuth state. Callbacks reject mismatched bound state before token exchange, and return only whitelisted display/status fields. Tokens remain server-side.

## 10. Popup OAuth

LinkedIn, Facebook, Instagram (via Facebook Login), and Canva use a synchronously opened popup where available. The return page sends a same-origin, source-checked, identifier-matched message. The parent refreshes provider status without resetting the editor, acknowledges the result, and the popup closes. A closed/failed popup gives feedback; a success notice depends on status verification. Overlapping connect attempts are guarded.

## 11. Redirect fallback

A blocked popup falls back to navigation after snapshot persistence. `/oauth-return` routes back to the app, which restores the snapshot before autosave resumes. Provider failure also retains the return identifier so work can be restored. Consumed snapshots are removed. Canva editor navigation also saves a snapshot for its full-page fallback while preserving the existing editor handshake. OAuth snapshots are not subject to the legacy localStorage autosave truncation; ordinary reload autosave still retains its pre-existing size fallback.

WhatsApp currently has no OAuth/auth/callback implementation. The common gateway returns an explicit unavailable error with the return identifier; it does not fake a connection. A live WhatsApp non-default-step OAuth test is therefore not applicable until that integration is defined.

## 12. Tests performed

- `node --test tests/product-flow.cjs`: seven passing tests covering preservation/order, actual scheduler storage APIs, corrupt-file protection, concurrent cancellation during a manual publish check, provider return-state binding/mismatch and secret exclusion, previews across media sources, actual Meta ALT payloads and duplicate suppression, and normalized image pixels sent to mocked vision.
- `npx tsc --noEmit`: passed.
- Targeted ESLint on new helpers, server routes, return page and preview: no errors; existing image optimization warnings remain.
- `git diff --check`: passed.
- Earlier isolated Chrome run passed: Step 4 snapshot restoration, ALT edit/clear/generate-missing, full draft save, Canva popup return, separate LinkedIn/Facebook/Instagram Step 6 popup returns, cancellation confirmation/toast/View Draft/newest ordering, and Schedule Again. External traffic was blocked and API responses mocked. No page errors were observed.
- Final Chrome rerun after the last callback-state validation, save guards, and Canva editor snapshot changes was blocked by automatic approval review due to an account usage limit. Those final changes are type/API checked but not browser reverified.

Browser test command (requires the installed Playwright runtime and localhost development server):

```sh
PLAYWRIGHT_MODULE=/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/editor-browser.cjs
```

## 13. Regressions found and fixed

Fixed mixed data/remote Facebook image ordering, different ALT descriptions on repeated carousel URLs, stale scheduler writes overwriting another record's cancellation, stale due-post data after earlier network calls, autosave racing OAuth restoration, and duplicate schedule/draft button submissions. Existing explicit publish locks, attempt IDs, cooldowns and provider duplicate protections remain. No effect-driven publishing or automatic publishing retry was added.

The whole-project lint is not clean: the existing large page/wizard contain React ref/effect/purity lint errors. No new lint error class was introduced, but this report does not claim those modules pass lint. Actual third-party publishing, Canva editor completion, and provider consent were not exercised live, so preservation is supported by code review and mocked tests rather than a blanket live-regression guarantee.

## 14. Pending checks and limitations

- Rerun Chrome after account/tool access permits it, including real blocked-popup and Canva editor completion scenarios.
- Manually authorize each configured provider from a populated non-default step, then validate real single-image/carousel ALT delivery and live vision generation when desired. No test post was authorized or sent in this work.
- WhatsApp OAuth remains unimplemented/disabled. LinkedIn company Page Community Management access and publishing remain pending from the earlier session.
- Existing lint debt remains. A production build was not part of this validation.
- JSON persistence and in-memory publish deduplication remain suitable for the current single local server. A process interrupted after claiming `publishing` requires manual reconciliation, not automatic retry; multi-process locking/durable jobs are future work.
- Public tunnel health and live credentials were not reverified. Existing platform connection history remains in `PULLOVER_OG.md`.
