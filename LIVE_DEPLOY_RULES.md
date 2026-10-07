# Live Deploy Rules — socialpulse.dotstark.tech

Standing operating procedure. Do not skip.

## Rule 1: Never restart live containers without warning first

NEVER run any of the following (or equivalents) without FIRST telling the
user and getting an explicit go-ahead:

- `docker compose up -d --build ...`
- `docker compose restart ...`
- `docker restart ...`
- any container recreate / image rebuild affecting the live stack

WHY: every rebuild/recreate stops the running container and boots a new
one — roughly a 30–60s window where the live site is unreachable. Any
Generate / publish / navigation click landing in that window fails outright.

INCIDENT (2026-10-06): user's first content-generation attempt failed
because it coincided with one of five same-day app-container rebuilds.
Retry after the restart succeeded. Backend was healthy throughout.

## Rule 2: Deploy protocol

1. Announce: what will be rebuilt + expected downtime (~1 min).
2. Ask the user to confirm they are not actively using the site right now.
3. Only then: commit, rebuild, wait for healthy status.
4. Verify: container healthy + `curl https://socialpulse.dotstark.tech/` → 200
   + new code markers present in the served bundle.
5. Report done with the verification evidence.

## Rule 3: Batch changes

Group edits into as few rebuilds as possible. Five rebuilds in one day is
how the 2026-10-06 incident happened. One deploy per batch, not per edit.

## Standing preview surfaces (local-only, never deploy these)

- Step 4 prototype: http://localhost:3021/ served from
  `experiments/content-studio-step4/` (python http.server).
  Rule (2026-10-07, user instruction): Step 4 preview/test changes belong
  ONLY to this page — make staged edits visible on this URL and use this
  URL for Step 4 review. Do not start rival Step 4 previews on other ports.
