# Verification suites

All suites create their own throwaway users and rows and delete them at the end.
None of them reset, migrate or truncate the database.

| Command | What it proves | Where it runs |
|---|---|---|
| `npm run test:isolation` | SQL-level per-user isolation + media retention + cleanup boundary | host (DB from `.env.local`) |
| `npm run test:isolation:http` | Route-level isolation with real signed sessions, real multipart uploads | inside the app container |
| `npm run test:whatsapp-qr` | WhatsApp QR lifecycle: no-scan never connects, exact-session confirmation, two-user isolation, webhook correlation | inside the app container |
| `npm run test:moderation-classifier` | Classifier quality: benign medical/art contexts must not false-positive; single anatomical words must never block | host, offline, no server needed |
| `npm run test:moderation:http` | Escalation: warn → flag → notify, Superadmin visibility/reversal, concurrency, no blocked media in the gallery | inside the app container |

## Why some run inside the container

The host's `localhost:5432` maps to a **different** Postgres (`socialpulse-dev-db`)
than the app uses (`socialpulse-db`, reached over the compose network). A suite
that creates fixtures on the host and asserts over HTTP would therefore be
testing two databases at once.

```bash
docker compose up -d socialpulse
docker cp scripts/verify-user-isolation-http.mjs socialpulse:/app/t.mjs
docker cp scripts/verify-whatsapp-qr.mjs          socialpulse:/app/t.mjs
docker cp scripts/verify-moderation.mjs           socialpulse:/app/t.mjs
docker exec -e BASE_URL=http://localhost:3000 socialpulse node /app/t.mjs
```

Or in one go:

```bash
for s in verify-user-isolation-http verify-whatsapp-qr verify-moderation; do
  docker cp scripts/$s.mjs socialpulse:/app/t.mjs
  docker exec -e BASE_URL=http://localhost:3000 socialpulse node /app/t.mjs
done
```
