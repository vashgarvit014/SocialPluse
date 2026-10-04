# SocialPulse Microservices Handoff

Updated on 2026-10-04 from branch `codex-next`.

## Baseline

- Trusted snapshot branch: `pullover_0.2`
- Snapshot commit: `2555d66`
- Current working branch: `codex-next`
- Do not modify remote `main`.
- `apps/web` is the normal frontend source tree; the runtime container may still be named `socialpulse` for compatibility.
- `apps/superadmin` is the independent Superadmin frontend; runtime container `socialpulse-superadmin-app`.

## Runtime Architecture

Browser traffic enters a frontend app, then uses the gateway as the controlled backend boundary. The gateway verifies browser cookies through auth-service and forwards trusted actor context plus service-to-service authorization to downstream services. Browser-supplied user id, role, and internal identity headers are not trusted.

## Services And Ownership

- gateway: external/backend routing boundary, service health, auth-service session verification handoff.
- auth-service: signup, login, logout, session verification, OTP, password reset/change, Superadmin auth checks, and Superadmin reset-access OTP.
- user-service: profile/account state, moderation metadata, and editor draft persistence.
- ai-service: AI generation, image variation, moderation, and alt-text execution.
- media-service: media asset persistence, uploads, reads, writes, and branded video.
- integrations-service: provider connection lifecycle and provider reads for Canva, LinkedIn, Facebook, Instagram status/disconnect, WhatsApp/Whapi connection/status/group/community/destination actions.
- publishing-service: provider publishing execution and idempotency for LinkedIn, Facebook, Instagram, Whapi, plus staged provider media reads.
- scheduler-service: sole due-job executor and scheduled post owner, including post-account scrub cleanup.
- analytics-service: analytics and AI usage reporting.
- admin-service: Superadmin reporting/action facade, audit/log/session/publishing/user-management aggregation, and calls to owning services.

## Frontend Apps

### apps/web

Active API routes are compatibility proxies or frontend redirect shims. Verified no active app route-level use of direct DB, `INTERNAL_SERVICE_SECRET`, provider secrets, AI secrets, SMTP/OTP secrets, auth mutation helpers, scheduler execution, publishing execution, or media persistence.

Legacy helper files still exist under `apps/web/src/lib`, and inert API helper stubs remain for compile compatibility, but active app routes no longer import them for backend execution.

### apps/superadmin

Uses gateway client and browser cookies. Verified no direct DB access, no direct `INTERNAL_SERVICE_SECRET` for browser-facing flows, and no direct auth/admin service calls bypassing gateway.

## Docker Runtime

Frontend containers retain only frontend-safe config: `NEXT_PUBLIC_APP_URL` and `GATEWAY_URL`.

Provider, database, SMTP/OTP, and internal service secrets are service-owned and remain in backend services.

All expected changed containers were rebuilt and verified healthy.

## Verification Summary

Passed:

- apps/web `npx tsc --noEmit`
- apps/superadmin `npx tsc --noEmit`
- Docker production builds for changed frontend apps and backend services
- `docker compose config --quiet`
- `docker compose ps` showed expected services healthy
- gateway aggregate health returned all upstreams ok
- forged actor/role request was rejected
- no-session Superadmin request was rejected
- no-session app AI request was rejected
- direct service request without internal secret was rejected
- failure isolation for integrations, publishing, auth, user, admin, and gateway kept unrelated services healthy

Not run against real providers:

- real public provider posts
- real OAuth callback completion
- real WhatsApp/Whapi message send

## Remaining Technical Debt

- Compatibility routes are intentionally retained until proven unused.
- Legacy backend helper files remain under `apps/web/src/lib`, but are inactive for audited app routes; remove later once all historical imports are gone.
- Gateway forwards identity assertion, but downstream services still primarily enforce trust through actor headers plus internal service secret.
- Suspended-account behavior needs a controlled fixture; destructive database mutation was not performed.
- Real provider end-to-end tests require sandbox credentials and explicit approval.
