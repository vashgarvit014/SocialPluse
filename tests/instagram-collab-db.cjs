// Run with: DATABASE_URL=... node --test tests/instagram-collab-db.cjs
// Live-DB check for the scheduler worker's collaborator persistence path
// (worker.mjs's buildBody -> callPublish -> processPlatform ->
// persistCollaboratorResults -> post-store.updateUserPost). Skipped when
// DATABASE_URL is unreachable, same convention as tests/scheduled-publish.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const url = (p) => pathToFileURL(path.join(root, p)).href;

test('worker: scheduled Instagram publish persists collaborator status into scheduled_posts.payload', async (t) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { t.skip('DATABASE_URL not set'); return; }
  let Pool;
  try { ({ Pool } = require('pg')); } catch { t.skip('pg not installed in this context'); return; }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 4000 });
  try { await pool.query('SELECT 1'); } catch { await pool.end().catch(() => {}); t.skip('database unreachable from this context'); return; }

  const { createPostStore } = await import(url('services/scheduler-service/src/post-store.mjs'));
  const { createPlatformStore } = await import(url('services/scheduler-service/src/platform-store.mjs'));
  const { createWorker } = await import(url('services/scheduler-service/src/worker.mjs'));

  const store = createPostStore(pool);
  const platformStore = createPlatformStore({ query: (...a) => pool.query(...a) });
  await platformStore.ensureSchema();

  const suffix = require('node:crypto').randomBytes(6).toString('hex');
  const userId = `00000000-0000-4000-8002-${suffix}`;
  const postId = `test-collab-post-${suffix}`;

  const collaborators = [
    { username: 'alice', type: 'professional', status: 'Not Requested' },
    { username: 'bob', type: 'private', status: 'Not Requested' },
  ];

  const originalFetch = globalThis.fetch;
  try {
    await pool.query(`INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, 'x', now(), now())`, [userId, 'Collab Worker Test', `collab-${suffix}@example.test`]);

    const post = await store.upsertUserPost(userId, {
      id: postId, content: 'hello from the collab worker test', imageUrl: 'https://cdn.example/a.jpg',
      platforms: ['instagram'], accounts: [{ platform: 'instagram', userId: 'ig-test-user' }],
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(), status: 'pending',
      createdAt: new Date().toISOString(), collaborators,
    });
    assert.ok(post.id, 'post created');
    // store.hydrate() never includes userId on its own (claimDueJob adds it
    // manually — see post-store.mjs) — publishOnePost needs it to resolve
    // the connection preflight and to scope every write.
    const claimedLikePost = { ...post, userId };

    // Mock only the outbound call to publishing-service — this is exactly
    // what buildBody()/callPublish() send, and what the real provider
    // (instagram.mjs, already covered by tests/instagram-collab.cjs) would
    // return for a professional+private mixed publish in MOCK_INSTAGRAM_COLLAB mode.
    globalThis.fetch = async (reqUrl, init = {}) => {
      const body = JSON.parse(init.body || '{}');
      assert.deepEqual(body.collaborators, [{ username: 'alice', type: 'professional' }, { username: 'bob', type: 'private' }], 'worker sent the full collaborator list to publishing-service');
      return {
        ok: true,
        json: async () => ({
          success: true, postId: 'ig-post-1', attemptId: body.attemptId,
          collaborators: [
            { username: 'alice', type: 'professional', status: 'Submitted' },
            { username: 'bob', type: 'private', status: 'Ready' },
          ],
          postUrl: 'https://www.instagram.com/p/mocktest/',
        }),
      };
    };

    const worker = createWorker({
      store, platformStore,
      connections: { preflight: async () => ({ ok: true, connectionId: `00000000-0000-4000-8003-${suffix}`, destination: 'ig-test-user' }) },
      notifier: null,
      log: { info() {}, warn() {}, error() {} },
      publishingServiceUrl: 'http://publishing-service.invalid',
      internalSecret: 'test-secret',
      workerId: 'test-worker',
    });

    const outcome = await worker.publishClaimed(claimedLikePost);
    assert.equal(outcome.status, 'published', 'post reached PUBLISHED');

    const reloaded = await store.getUserPost(userId, postId);
    assert.deepEqual(
      reloaded.collaborators.map((c) => ({ username: c.username, type: c.type, status: c.status })),
      [
        { username: 'alice', type: 'professional', status: 'Submitted' },
        { username: 'bob', type: 'private', status: 'Ready' },
      ],
      'collaborator statuses were persisted to the real database by the worker, not just returned in-memory',
    );
    assert.equal(reloaded.instagramPostUrl, 'https://www.instagram.com/p/mocktest/', 'permalink was persisted too');
  } finally {
    globalThis.fetch = originalFetch;
    await pool.query('DELETE FROM scheduled_post_platforms WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM scheduled_posts WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end().catch(() => {});
  }
});
