# infrastructure/docker

`docker-compose.yml` deliberately **stays at the repository root**, not
here. Reasoning, recorded during the repository restructure:

- Every service's `build.context` and every bind-mount's host path
  (`./.media-assets`, `./scheduled-posts.json`, `.env.local`, etc.) is
  resolved relative to wherever the compose file itself lives. Moving it
  here would mean rewriting every one of those paths for zero functional
  benefit — compose files conventionally live at the repo root in most
  Docker projects anyway.
- The `docker compose up -d` invocation documented throughout
  `MIGRATION-NOTES.md` assumes the compose file is at the root; moving it
  would break that muscle memory and every existing runbook note for no
  gain.

This folder exists only so `infrastructure/` matches the planned target
layout. `infrastructure/gateway/` (the actual gateway service) is
unaffected and lives where it always has.
