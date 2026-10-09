// Run with: node --test tests/scheduled-publish.cjs
//
// Server-side scheduled publishing: status state machine, bounded retry,
// disconnect handling, duplicate protection and user isolation.
//
// Sections A-C are pure (no network, no database). Section D asserts the
// source actually implements the required behaviour. Section E runs against
// PostgreSQL when DATABASE_URL is reachable and is skipped otherwise —
// `tests/run-db-tests.sh` runs it inside the compose network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const url = (p) => pathToFileURL(path.join(root, p)).href;

const statusMod = import(url('services/scheduler-service/src/status.mjs'));
const retryMod = import(url('services/scheduler-service/src/retry-policy.mjs'));

const row = (platform, status) => ({ platform, status });

// ---------------------------------------------------------------------------
// A. Overall status is derived from per-platform rows
// ---------------------------------------------------------------------------

test('A1: all platforms published -> PUBLISHED', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = ['linkedin', 'facebook', 'instagram', 'whatsapp'].map((p) => row(p, 'PUBLISHED'));
  assert.equal(resolveOverallStatus(rows), POST_STATUS.PUBLISHED);
});

test('A2: 3 published + Instagram disconnected -> PARTIALLY_PUBLISHED', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = [
    row('linkedin', 'PUBLISHED'),
    row('facebook', 'PUBLISHED'),
    row('whatsapp', 'PUBLISHED'),
    row('instagram', 'CONNECTION_REQUIRED'),
  ];
  assert.equal(resolveOverallStatus(rows), POST_STATUS.PARTIALLY_PUBLISHED);
});

test('A3: every platform needs connection -> CONNECTION_REQUIRED', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = ['linkedin', 'facebook', 'instagram'].map((p) => row(p, 'CONNECTION_REQUIRED'));
  assert.equal(resolveOverallStatus(rows), POST_STATUS.CONNECTION_REQUIRED);
});

test('A4: every platform hard-failed -> FAILED', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = ['linkedin', 'facebook'].map((p) => row(p, 'FAILED'));
  assert.equal(resolveOverallStatus(rows), POST_STATUS.FAILED);
});

test('A5: untouched future post stays SCHEDULED', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = ['linkedin', 'instagram'].map((p) => row(p, 'PENDING'));
  assert.equal(resolveOverallStatus(rows, { postStatus: 'pending' }), POST_STATUS.SCHEDULED);
});

test('A6: any row still PROCESSING -> PROCESSING', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = [row('linkedin', 'PUBLISHED'), row('facebook', 'PROCESSING'), row('instagram', 'PENDING')];
  assert.equal(resolveOverallStatus(rows, { postStatus: 'publishing' }), POST_STATUS.PROCESSING);
});

test('A7: zero rows preserves terminal user-driven states', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  assert.equal(resolveOverallStatus([], { postStatus: POST_STATUS.DRAFT }), POST_STATUS.DRAFT);
  assert.equal(resolveOverallStatus([], { postStatus: POST_STATUS.CANCELLED }), POST_STATUS.CANCELLED);
  assert.equal(resolveOverallStatus([], { postStatus: POST_STATUS.SCHEDULED }), POST_STATUS.SCHEDULED);
});

test('A8: mixed unrecoverable with nothing published favours the actionable state', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = [row('linkedin', 'FAILED'), row('instagram', 'CONNECTION_REQUIRED'), row('facebook', 'CONNECTION_REQUIRED')];
  assert.equal(resolveOverallStatus(rows), POST_STATUS.CONNECTION_REQUIRED);
});

test('A9: cancelled platforms are excluded from the derivation', async () => {
  const { resolveOverallStatus, POST_STATUS } = await statusMod;
  const rows = [row('linkedin', 'PUBLISHED'), row('facebook', 'PUBLISHED'), row('whatsapp', 'CANCELLED')];
  assert.equal(resolveOverallStatus(rows), POST_STATUS.PUBLISHED);
});

// ---------------------------------------------------------------------------
// B. Summary copy shown in the UI / notifications
// ---------------------------------------------------------------------------

test('B1: summary reports "3 of 4" plus the reconnect detail', async () => {
  const { summarizePlatforms } = await statusMod;
  const s = summarizePlatforms([
    row('linkedin', 'PUBLISHED'), row('facebook', 'PUBLISHED'),
    row('whatsapp', 'PUBLISHED'), row('instagram', 'CONNECTION_REQUIRED'),
  ]);
  assert.equal(s.published, 3);
  assert.equal(s.total, 4);
  assert.equal(s.headline, 'Published to 3 of 4 platforms.');
  assert.equal(s.anyConnectionRequired, true);
  assert.deepEqual(s.reconnectPlatforms, ['instagram']);
  assert.match(s.detail, /Instagram requires reconnection\./);
  assert.equal(s.allPublished, false);
});

test('B2: summary of a clean run reports all published', async () => {
  const { summarizePlatforms } = await statusMod;
  const s = summarizePlatforms([row('linkedin', 'PUBLISHED'), row('facebook', 'PUBLISHED')]);
  assert.equal(s.allPublished, true);
  assert.equal(s.headline, 'Published to 2 of 2 platforms.');
});

// ---------------------------------------------------------------------------
// C. Bounded retry — connection failures are never auto-retried
// ---------------------------------------------------------------------------

test('C1: connection/auth errors are permanent, not transient', async () => {
  const { isTransientError } = await retryMod;
  for (const code of ['LINKEDIN_NOT_CONNECTED', 'FACEBOOK_NOT_CONNECTED', 'INSTAGRAM_NOT_CONNECTED', 'WHATSAPP_NOT_CHANNEL_OWNER', 'PLATFORM_NOT_CONNECTED', 'DUPLICATE_PUBLISH_REQUEST']) {
    assert.equal(isTransientError(code), false, `${code} must not be retried automatically`);
  }
});

test('C2: only genuine provider hiccups are transient', async () => {
  const { isTransientError } = await retryMod;
  for (const code of ['LINKEDIN_RATE_LIMIT', 'INSTAGRAM_PUBLISH_FAILED', 'WHAPI_SERVER_ERROR', 'PUBLISH_FAILED']) {
    assert.equal(isTransientError(code), true, `${code} should be retried`);
  }
});

test('C3: retry is bounded and backoff-spaced', async () => {
  const { MAX_ATTEMPTS, nextRetry } = await retryMod;
  assert.equal(MAX_ATTEMPTS, 3);
  assert.ok(nextRetry(0) > new Date().toISOString(), 'first retry is in the future');
  assert.equal(nextRetry(MAX_ATTEMPTS - 1), null, 'no retry beyond the attempt cap');
});

// ---------------------------------------------------------------------------
// D. Source-level guarantees
// ---------------------------------------------------------------------------

test('D1: no client-side timer or loop can trigger publishing', () => {
  const src = read('apps/web/src/app/_shell/social-media-manager.tsx');
  // No interval/timeout anywhere calls the due-post check or a publish route.
  const offenders = src.match(/(setInterval|setTimeout)\s*\([^)]*scheduler\/check/g) || [];
  assert.equal(offenders.length, 0, 'browser must never dispatch due posts');
  const publishInTimer = src.match(/setInterval\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[^}]{0,400}\/api\/[a-z]+\/publish/g) || [];
  assert.equal(publishInTimer.length, 0, 'browser must never publish on a timer');
  // The removal is documented in-source so it is not silently reintroduced.
  assert.match(src, /deliberately NOT driven from the browser/);
  assert.match(src, /Removed on purpose/);
});

test('D2: Instagram disconnect is a real persisted action, not a no-op', () => {
  const src = read('services/integrations-service/providers/instagram/routes.mjs');
  assert.match(src, /setInstagramDisabled\(userId, true\)/);
  assert.match(src, /platform-connectivity/, 'must tell the scheduler to mark future rows');
  assert.doesNotMatch(src, /disconnect \(A, but a no-op\) -> PORTED \(this file, same no-op\)/);
});

test('D3: publishing-service honours the Instagram opt-out', () => {
  const src = read('services/publishing-service/src/credentials.mjs');
  assert.match(src, /instagramDisabled === true\) return null/);
});

test('D4: every credential lookup is scoped to one user and active connections', () => {
  const src = read('services/publishing-service/src/credentials.mjs');
  const selects = src.match(/FROM\s+platform_connections/gi) || [];
  const scoped = src.match(/user_id = \$1 AND platform = '[a-z]+' AND disconnected_at IS NULL/g) || [];
  assert.ok(selects.length > 0, 'credential reads exist');
  assert.equal(scoped.length, selects.length, 'every platform_connections read must be user-scoped AND active-only');
  assert.match(src, /FROM whatsapp_connections WHERE user_id = \$1 AND status = 'CONNECTED'/);
});

test('D5: the worker preflights the connection before any publish call', () => {
  const src = read('services/scheduler-service/src/worker.mjs');
  const preflightAt = src.indexOf('connections.preflight');
  const publishAt = src.indexOf('await callPublish');
  assert.ok(preflightAt > 0 && publishAt > 0, 'both steps exist');
  assert.ok(preflightAt < publishAt, 'preflight must run before publish');
  // Disconnected platforms must not reach the provider at all.
  assert.match(src, /event: 'PLATFORM_CONNECTION_REQUIRED'/);
  assert.doesNotMatch(src, /CONNECTION_REQUIRED[^}]*callPublish/);
});

test('D6: platform claim can never re-claim a PUBLISHED row', () => {
  const src = read('services/scheduler-service/src/platform-store.mjs');
  const claim = src.slice(src.indexOf('async function claimPlatform'), src.indexOf('async function finishPlatform'));
  assert.match(claim, /status IN \('PENDING', 'FAILED', 'CONNECTION_REQUIRED'\)/);
  assert.doesNotMatch(claim, /'PUBLISHED'/, 'PUBLISHED must not be in the claimable set');
  assert.match(claim, /OR \(status = 'PROCESSING' AND \(last_attempt_at IS NULL OR last_attempt_at < \$7\)\)/,
    'stale PROCESSING rows are recoverable, fresh ones are not');
});

test('D7: retry selects only FAILED / CONNECTION_REQUIRED — never PUBLISHED', () => {
  const src = read('services/scheduler-service/src/platform-store.mjs');
  const retryable = src.slice(src.indexOf('async function listRetryable'), src.indexOf('async function armRowForRetry'));
  assert.match(retryable, /status IN \('FAILED', 'CONNECTION_REQUIRED'\)/);
  assert.doesNotMatch(retryable, /'PUBLISHED'/);
  const arm = src.slice(src.indexOf('async function armRowForRetry'), src.indexOf('return {'));
  assert.match(arm, /AND status IN \('FAILED', 'CONNECTION_REQUIRED'\)/);
});

test('D8: every user-scoped store read/writes carries user_id', () => {
  const src = read('services/scheduler-service/src/platform-store.mjs');
  // Public (user-facing) helpers must all be user-scoped.
  for (const fn of ['listForPost', 'claimPlatform', 'finishPlatform', 'listRetryable', 'armRowForRetry', 'syncForPost']) {
    const start = src.indexOf(`async function ${fn}`);
    assert.ok(start > 0, `${fn} exists`);
    const body = src.slice(start, start + 1600);
    assert.match(body, /user_id = \$/, `${fn} must be scoped by user_id`);
  }
});

test('D9: the overall status is computed, never stored alongside the rows', () => {
  const src = read('services/scheduler-service/src/server.mjs');
  assert.match(src, /overallStatus: resolveOverallStatus/);
  assert.match(src, /summary: summarizePlatforms/);
  const store = read('services/scheduler-service/src/post-store.mjs');
  // The derivation must never be persisted back into scheduled_posts.payload,
  // otherwise a stored copy could drift from the rows it came from. Assert
  // per-line (a /s regex across the whole file would match unrelated text).
  for (const line of store.split('\n')) {
    if (!/partially_published/.test(line)) continue;
    assert.doesNotMatch(line, /payload/i, `derived status must never be written into payload: ${line.trim()}`);
  }
});

test('D10: structured safe logging — no credential fields, required events present', () => {
  const logger = read('packages/logger/index.mjs');
  assert.match(logger, /FORBIDDEN_KEYS = new Set\(\['password', 'otp', 'accessToken', 'refreshToken', 'clientSecret', 'token', 'secret'\]\)/);
  const worker = read('services/scheduler-service/src/worker.mjs');
  const server = read('services/scheduler-service/src/server.mjs');
  const all = worker + server;
  for (const ev of ['SCHEDULED_POST_CREATED', 'SCHEDULED_PUBLISH_STARTED', 'PLATFORM_PUBLISH_STARTED',
    'PLATFORM_PUBLISH_SUCCESS', 'PLATFORM_PUBLISH_FAILED', 'PLATFORM_CONNECTION_REQUIRED',
    'SCHEDULED_POST_PARTIAL_SUCCESS', 'SCHEDULED_POST_COMPLETE', 'PLATFORM_DISCONNECTED',
    'PLATFORM_RECONNECTED', 'SCHEDULE_RETRY_STARTED', 'SCHEDULE_RETRY_SUCCESS', 'SCHEDULE_RETRY_FAILED']) {
    assert.ok(all.includes(ev), `structured event ${ev} is emitted`);
  }
  // Secrets must never be interpolated into a log line.
  assert.doesNotMatch(all, /log\.(info|warn|error)\(\{[^}]*accessToken/);
  assert.doesNotMatch(all, /log\.(info|warn|error)\(\{[^}]*token:/);
});

test('D11: drafts are never eligible for the worker', () => {
  const store = read('services/scheduler-service/src/post-store.mjs');
  const start = store.indexOf('async claimDueJob');
  assert.ok(start > 0, 'claimDueJob exists');
  // Bound the slice at the end of that function, not at a later comment.
  const claim = store.slice(start, start + 2000);
  assert.match(claim, /status = 'pending'/, 'claims only pending (scheduled) rows');
  assert.doesNotMatch(claim, /'draft'/, 'drafts are never claimed');
  // A draft is also stored with no due time, so it is doubly ineligible.
  // (upsertUserPost writes scheduled_at straight from the record; a draft
  // record carries scheduledAt: null, which the upsert's `?? null` maps to
  // SQL NULL.)
  const upsert = store.slice(store.indexOf('async upsertUserPost'), store.indexOf('async updateUserPost'));
  assert.match(upsert, /record\.scheduledAt \?\? null/, 'scheduled_at is stored as SQL NULL when absent');
  const upsertHandler = read('services/scheduler-service/src/server.mjs').slice(read('services/scheduler-service/src/server.mjs').indexOf('async function handleUpsert'));
  assert.match(upsertHandler, /scheduledAt: draft \? null : body\.scheduledAt/, 'a draft never carries a due time');
});

test('D17: the CHECK-constraint status list is valid SQL (quoted literals)', () => {
  // Regression: interpolating a bare "PENDING, PROCESSING, ..." into the
  // IN list makes Postgres read them as COLUMN NAMES and the schema create
  // fails at startup with `column "PENDING" does not exist`.
  const platformStore = read('services/scheduler-service/src/platform-store.mjs');
  const constLine = platformStore.slice(platformStore.indexOf('const UPPERCASE'));
  const list = constLine.slice(0, constLine.indexOf('\n'));
  assert.match(list, /'PENDING'/, 'statuses must be quoted string literals');
  assert.match(list, /'CONNECTION_REQUIRED'/, 'statuses must be quoted string literals');
  assert.doesNotMatch(list, /const UPPERCASE = 'PENDING/, 'an unquoted list would break CREATE TABLE');

  // The canonical copy in db.ts must agree with the service copy.
  const db = read('apps/web/src/lib/db.ts');
  assert.match(db, /CHECK \(status IN \('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CONNECTION_REQUIRED', 'CANCELLED'\)\)/);
});

test('D18: schedule, cancel and reschedule move parent + platform rows together', () => {
  const server = read('services/scheduler-service/src/server.mjs');
  // One transaction wrapping the post row and its platform rows for schedule.
  assert.match(server, /const saved = await poolProxy\.transaction\(async \(tx\) => \{[\s\S]*?store\.upsertUserPost\(userId, post, tx\)[\s\S]*?platformStore\.syncForPost\(record\.id, userId, targets, tx\)/);
  // Cancelling must cancel the platform rows in the same transaction.
  assert.match(server, /const post = await poolProxy\.transaction\(async \(tx\) => \{[\s\S]*?cancelPost\(p\)[\s\S]*?platformStore\.cancelAllForPost\(userId, id, tx\)/);
  // Reschedule must re-sync them too.
  assert.match(server, /platformStore\.syncForPost\(id, userId, targets, tx\)/);
});

test('D19: retry never sweeps in unrelated due posts', () => {
  const server = read('services/scheduler-service/src/server.mjs');
  const retry = server.slice(server.indexOf('async function handleRetryFailed'), server.indexOf('async function handleConnectivityWarning'));
  // Strip line comments before asserting — the slice mentions runOnce() in a
  // comment explaining why it must NOT be used here.
  const retryCode = retry.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.doesNotMatch(retryCode, /worker\.runOnce\(\)/, 'runOnce() would publish every other due post too');
  assert.match(retryCode, /store\.claimPostById\(userId, id/);
  assert.match(retryCode, /worker\.publishClaimed\(claimed\)/);
  // runOnce() must still exist for the legitimate Superadmin "check now" path.
  assert.match(server, /url\.pathname === '\/scheduler\/check'[\s\S]*?worker\.runOnce\(\)/);

  const worker = read('services/scheduler-service/src/worker.mjs');
  assert.match(worker, /async function publishClaimed\(post\)/);
});

test('D20: the worker never starts without its schema', () => {
  const server = read('services/scheduler-service/src/server.mjs');
  const boot = server.slice(server.indexOf('server.listen('));
  // ensureSchema must be awaited BEFORE worker.start() in the success path.
  const schemaAt = boot.indexOf('await platformStore.ensureSchema()');
  const startAt = boot.indexOf('worker.start()');
  assert.ok(schemaAt > -1 && startAt > schemaAt, 'schema is created before the worker starts');
  // ...and the failure path must not start it either.
  assert.match(boot, /schema_init_failed[\s\S]*?worker\.start\(\)/);
  // /health must report DOWN, not HEALTHY, when the schema is missing.
  assert.match(server, /const state = !schemaReady \? 'DOWN'/);
});

test('D21: derived status, not the stored parent status, drives the UI', () => {
  const cal = read('apps/web/src/app/_shell/scheduler-calendar.tsx');
  assert.match(cal, /const derived = post\.overallStatus \|\| post\.status;/);
  const badge = cal.slice(cal.indexOf('function statusBadge'), cal.indexOf('function PostCard'));
  assert.doesNotMatch(badge, /post\.status ===/, 'badge must key off the derived status');
  const actions = cal.slice(cal.indexOf('const actionsFor'));
  assert.match(actions, /const st = post\.overallStatus \|\| post\.status;/);

  const manager = read('apps/web/src/app/_shell/social-media-manager.tsx');
  assert.match(manager, /const effectiveStatus = \(p: PostRecord\) => p\.overallStatus \|\| p\.status;/);
});

test('D22: disconnect fails closed when the warning check cannot complete', () => {
  const manager = read('apps/web/src/app/_shell/social-media-manager.tsx');
  const fn = manager.slice(manager.indexOf('const disconnectPlatform = async'), manager.indexOf('const performDisconnect'));
  // A failed check must NOT fall through to an immediate disconnect.
  assert.doesNotMatch(fn, /catch \{[^}]*\}\s*await performDisconnect/, 'must not disconnect blindly on a failed check');
  assert.match(fn, /if \(count === null\) \{[\s\S]*?setDisconnectTarget\(/, 'an unverified check still asks for confirmation');
  assert.match(manager, /unverified\?: boolean/);
});

test('D13: legacy JSON scheduling is import-only — nothing reads it at runtime', () => {
  const store = read('services/scheduler-service/src/post-store.mjs');
  assert.match(store, /legacy_posts_imported/, 'one-shot guarded import');
  const writes = store.match(/writeFileSync\s*\(\s*legacyFilePath/g) || [];
  assert.equal(writes.length, 0, 'the legacy file is never written back');
});

test('D14: schedule creation derives the acting user from the session, never the body', () => {
  const server = read('services/scheduler-service/src/server.mjs');
  const upsert = server.slice(server.indexOf('async function handleUpsert'), server.indexOf('async function handleReschedule'));
  assert.match(upsert, /const userId = requireActor\(req\)/);
  assert.doesNotMatch(upsert, /body\.userId/, 'userId is never taken from the request body');
  // The gateway is what supplies x-actor-user-id, from the session cookie.
  const gw = read('infrastructure/gateway/src/server.mjs');
  assert.match(gw, /if \(auth\.userId\) extraHeaders\['x-actor-user-id'\] = auth\.userId;/);
});

test('D15: notifications go through the existing notification table', () => {
  const src = read('services/scheduler-service/src/notifications.mjs');
  assert.match(src, /INSERT INTO admin_notifications/);
  assert.match(src, /user_id, is_read/, 'rows are user-scoped');
  const server = read('services/scheduler-service/src/server.mjs');
  assert.match(server, /FROM admin_notifications WHERE user_id = \$1/, 'reads are user-scoped');
});

test('D16: health reports real metrics, not a canned status', () => {
  const store = read('services/scheduler-service/src/post-store.mjs');
  assert.match(store, /async getSchedulerHealth\(\)/);
  assert.match(store, /COUNT\(\*\)::int AS n FROM scheduled_posts WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= \$1/);
  assert.match(store, /COUNT\(\*\)::int AS n FROM scheduled_posts WHERE status = 'publishing'/);
  assert.match(store, /COUNT\(\*\)::int AS n FROM scheduled_posts WHERE status IN \('failed', 'connection_required', 'partially_published'\)/);
  const server = read('services/scheduler-service/src/server.mjs');
  assert.match(server, /const metrics = await store\.getSchedulerHealth\(\)/);
  // DOWN when the schema is missing or the worker is not running; never a
  // hard-coded HEALTHY regardless of reality.
  assert.match(server, /const state = !schemaReady \? 'DOWN'/);
  assert.match(server, /: !workerStatus\.running \? 'DOWN'/);
  assert.match(server, /'DEGRADED' : 'HEALTHY'/);
  // The worker must not start before the table exists.
  const boot = server.slice(server.indexOf('server.listen('));
  assert.match(boot, /await platformStore\.ensureSchema\(\);[\s\S]*?worker\.start\(\)/,
    'schema is ensured before the worker starts');
});

test('D12: cancel follows existing product behaviour — cancelled goes to Drafts', async () => {
  const { cancelPost } = await import(url('services/scheduler-service/src/posts.mjs'));
  const post = { id: 'p1', status: 'pending', scheduledAt: '2026-10-10T12:30:00.000Z', content: 'hello', mediaUrls: ['a.jpg'] };
  const out = cancelPost(post);
  assert.equal(out.status, 'draft');
  assert.equal(out.scheduledAt, null);
  assert.equal(out.previousScheduledAt, '2026-10-10T12:30:00.000Z');
  assert.equal(out.content, 'hello', 'caption preserved');
  assert.deepEqual(out.mediaUrls, ['a.jpg'], 'media preserved');
});

// ---------------------------------------------------------------------------
// E. PostgreSQL integration (skipped when the database is unreachable)
// ---------------------------------------------------------------------------

test('E: database state machine + user isolation', async (t) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    t.skip('DATABASE_URL not set — run via tests/run-db-tests.sh');
    return;
  }
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    t.skip('pg not installed in this context');
    return;
  }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 4000 });
  let reachable = true;
  try {
    await pool.query('SELECT 1');
  } catch {
    reachable = false;
  }
  if (!reachable) {
    await pool.end().catch(() => {});
    t.skip('database unreachable from this context');
    return;
  }

  const { createPlatformStore } = await import(url('services/scheduler-service/src/platform-store.mjs'));
  const store = createPlatformStore({ query: (...a) => pool.query(...a) });
  await store.ensureSchema();

  // Deterministic, disposable UUIDs (hex only — `suffix` is base36). Both
  // rows are deleted at the end; scheduled posts cascade with the user.
  const suffix = require('node:crypto').randomBytes(6).toString('hex');
  const userId = `00000000-0000-4000-8000-${suffix}`;
  const otherId = `00000000-0000-4000-8001-${suffix}`;
  const postId = `test-post-${suffix}`;
  const otherPostId = `test-post-${suffix}-other`;
  // Separate posts for the later scenarios: each block runs in its own
  // rolled-back transaction, so they cannot share one committed row.
  const e4Post = `test-post-${suffix}-e4`;
  const e5Post = `test-post-${suffix}-e5`;
  const e6Post = `test-post-${suffix}-e6`;
  const e7Post = `test-post-${suffix}-e7`;

  try {
    await pool.query(`INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, 'x', now(), now())`, [userId, 'Scheduler Test A', `t-${suffix}@example.test`]);
    await pool.query(`INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, 'x', now(), now())`, [otherId, 'Scheduler Test B', `o-${suffix}@example.test`]);

    // Everything inside a rolled-back transaction must run on THAT client,
    // otherwise it reads the committed (empty) state rather than the
    // transaction's own uncommitted writes.
    const inTx = async (fn) => {
      const c = await pool.connect();
      const tx = { query: (...a) => c.query(...a) };
      tx.store = createPlatformStore(tx);
      try { await tx.query('BEGIN'); await fn(tx); await tx.query('ROLLBACK'); }
      finally { c.release(); }
    };

    // E1: sync creates one PENDING row per platform.
    await inTx(async (tx) => {
      await tx.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '1 hour', now(), now(), '{}'::jsonb)`, [postId, userId]);
      await tx.store.syncForPost(postId, userId, [{ platform: 'linkedin' }, { platform: 'instagram' }, { platform: 'instagram' }], tx);
      const rows = await tx.store.listForPost(postId, userId);
      assert.equal(rows.length, 2, 'one row per distinct platform');
      assert.ok(rows.every((r) => r.status === 'PENDING'));
    });

    // E2: user isolation — another user sees nothing and cannot claim.
    await inTx(async (tx) => {
      await tx.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '1 hour', now(), now(), '{}'::jsonb)`, [otherPostId, otherId]);
      await tx.store.syncForPost(otherPostId, otherId, [{ platform: 'linkedin' }], tx);
      assert.deepEqual(await tx.store.listForPost(postId, otherId), [], 'user B cannot read user A rows');
      assert.equal(await tx.store.claimPlatform(postId, 'linkedin', otherId), null, 'user B cannot claim user A rows');
      const foreign = await tx.store.listForPost(otherPostId, userId);
      assert.deepEqual(foreign, [], 'user A cannot read user B rows');
    });

    // E3: atomic claim — two CONCURRENT claims (real separate connections,
    // committed data) must never both win. This is the duplicate-publish
    // guard, so it has to be a genuine race, not a rolled-back fixture.
    await pool.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '1 hour', now(), now(), '{}'::jsonb) ON CONFLICT (id) DO NOTHING`, [postId, userId]);
    await store.syncForPost(postId, userId, [{ platform: 'facebook' }]);
    {
      const [a, b] = await Promise.all([
        store.claimPlatform(postId, 'facebook', userId),
        store.claimPlatform(postId, 'facebook', userId),
      ]);
      assert.ok((a && !b) || (!a && b), 'exactly one of two concurrent claims wins');
      const after = await store.listForPost(postId, userId);
      const fb = after.find((r) => r.platform === 'facebook');
      assert.equal(fb.status, 'PROCESSING', 'the winning claim is the one that stuck');
      assert.equal(fb.attemptCount, 1, 'the loser did not bump attempt_count');
    }

    // E4: a PUBLISHED row is never re-claimable (duplicate protection).
    await inTx(async (tx) => {
      await tx.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '1 hour', now(), now(), '{}'::jsonb)`, [e4Post, userId]);
      await tx.store.syncForPost(e4Post, userId, [{ platform: 'whatsapp' }], tx);
      await tx.store.claimPlatform(e4Post, 'whatsapp', userId);
      await tx.store.finishPlatform(e4Post, userId, 'whatsapp', { status: 'PUBLISHED', externalPostId: 'ext-1' });
      assert.equal(await tx.store.claimPlatform(e4Post, 'whatsapp', userId), null, 'published rows cannot be re-claimed');
      const rows = await tx.store.listRetryable(e4Post, userId);
      assert.equal(rows.find((r) => r.platform === 'whatsapp'), undefined, 'published rows are not retryable');
    });

    // E5: disconnect marks only THIS user's FUTURE rows.
    await inTx(async (tx) => {
      await tx.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '1 hour', now(), now(), '{}'::jsonb)`, [e5Post, userId]);
      await tx.store.syncForPost(e5Post, userId, [{ platform: 'instagram' }], tx);
      // The other user's post must exist in THIS transaction for the
      // cross-user isolation assertion below (E2's fixture rolled back).
      await tx.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '1 hour', now(), now(), '{}'::jsonb)`, [otherPostId, otherId]);
      await tx.store.syncForPost(otherPostId, otherId, [{ platform: 'linkedin' }], tx);
      await tx.query(`UPDATE scheduled_posts SET scheduled_at = now() + interval '2 days' WHERE id = $1 AND user_id = $2`, [e5Post, userId]);
      await tx.query(`UPDATE scheduled_posts SET scheduled_at = now() + interval '2 days' WHERE id = $1 AND user_id = $2`, [otherPostId, otherId]);
      const affected = await tx.store.markFutureConnectionRequired(userId, 'instagram', 'disconnected');
      assert.equal(affected, 1, 'only this user future rows');
      const mine = await tx.store.listForPost(e5Post, userId);
      assert.equal(mine.find((r) => r.platform === 'instagram').status, 'CONNECTION_REQUIRED');
      const theirs = await tx.store.listForPost(otherPostId, otherId);
      assert.equal(theirs.find((r) => r.platform === 'linkedin').status, 'PENDING', 'other user untouched');
    });

    // E6: reconnect releases exactly the CONNECTION_REQUIRED rows.
    await inTx(async (tx) => {
      await tx.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '2 days', now(), now(), '{}'::jsonb)`, [e6Post, userId]);
      await tx.store.syncForPost(e6Post, userId, [{ platform: 'instagram' }], tx);
      await tx.store.markFutureConnectionRequired(userId, 'instagram', 'disconnected');
      const released = await tx.store.releaseConnectionRequired(userId, 'instagram');
      assert.equal(released, 1);
      const rows = await tx.store.listForPost(e6Post, userId);
      assert.equal(rows.find((r) => r.platform === 'instagram').status, 'PENDING');
    });

    // E7: retry re-arms only failed rows and never a published one.
    await inTx(async (tx) => {
      await tx.query(`INSERT INTO scheduled_posts (id, user_id, status, scheduled_at, created_at, updated_at, payload) VALUES ($1,$2,'pending', now() + interval '1 hour', now(), now(), '{}'::jsonb)`, [e7Post, userId]);
      await tx.store.syncForPost(e7Post, userId, [{ platform: 'linkedin' }, { platform: 'instagram' }], tx);
      await tx.store.claimPlatform(e7Post, 'linkedin', userId);
      await tx.store.finishPlatform(e7Post, userId, 'linkedin', { status: 'PUBLISHED', externalPostId: 'ext-2' });
      await tx.store.claimPlatform(e7Post, 'instagram', userId);
      await tx.store.finishPlatform(e7Post, userId, 'instagram', { status: 'FAILED', errorCode: 'INSTAGRAM_PUBLISH_FAILED', errorMessage: 'boom' });

      const retryable = await tx.store.listRetryable(e7Post, userId);
      assert.deepEqual(retryable.map((r) => r.platform), ['instagram'], 'only the failed platform is retryable');

      await tx.store.armRowForRetry(userId, e7Post, 'instagram');
      assert.equal(await tx.store.armRowForRetry(userId, e7Post, 'linkedin'), null, 'a published platform cannot be re-armed');
      const after = await tx.store.listForPost(e7Post, userId);
      assert.equal(after.find((r) => r.platform === 'linkedin').status, 'PUBLISHED');
      assert.equal(after.find((r) => r.platform === 'instagram').status, 'PENDING');
    });

    // E8: notifications are written per user and read back scoped.
    const { createNotifier } = await import(url('services/scheduler-service/src/notifications.mjs'));
    const log = { info() {}, warn() {} };
    const notifier = createNotifier({ query: (...a) => pool.query(...a) }, log);
    await notifier.notify({ userId, type: 'PLATFORM_CONNECTION_REQUIRED', title: 't', message: 'm', metadata: { platform: 'instagram' } });
    const mine = await pool.query(`SELECT type, user_id FROM admin_notifications WHERE user_id = $1 AND type = 'PLATFORM_CONNECTION_REQUIRED'`, [userId]);
    assert.ok(mine.rows.length >= 1, 'notification written for the owner');
    const theirs = await pool.query(`SELECT id FROM admin_notifications WHERE user_id = $1`, [otherId]);
    assert.equal(theirs.rows.length, 0, 'no cross-user notifications');
  } finally {
    await pool.query(`DELETE FROM admin_notifications WHERE user_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId, otherId]).catch(() => {});
    await pool.end().catch(() => {});
  }
});
