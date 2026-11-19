// Canva routes in integrations-service, with an in-memory database and a mocked Canva API.
// No network, no real database, no credentials.
//   node --test tests/canva-routes.test.mjs   (from the repo root)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.CANVA_CLIENT_ID = 'test-client';
process.env.CANVA_CLIENT_SECRET = 'test-secret';
process.env.CANVA_REDIRECT_URI = 'https://socialpulse.example/api/canva/callback';
process.env.MEDIA_SERVICE_URL = 'http://media.test';

const { createCanvaRouter } = await import('../services/integrations-service/providers/canva/routes.mjs');

// ── in-memory stand-in for the two tables the Canva routes use ──
let handshakes, connections;
const pool = {
  async query(sql, p = []) {
    const now = () => new Date().toISOString();
    if (/INSERT INTO oauth_handshakes/.test(sql)) {
      handshakes.push({ id: p[0], user_id: p[1], platform: p[2], state_key: p[3], data: JSON.parse(p[4]), expires_at: p[6] });
      return { rows: [], rowCount: 1 };
    }
    if (/DELETE FROM oauth_handshakes WHERE user_id = \$1 AND platform = \$2 AND state_key = \$3/.test(sql)) {
      const i = handshakes.findIndex((h) => h.user_id === p[0] && h.platform === p[1] && h.state_key === p[2] && h.expires_at > p[3]);
      if (i < 0) return { rows: [], rowCount: 0 };
      const [h] = handshakes.splice(i, 1);
      return { rows: [{ data: h.data }], rowCount: 1 };
    }
    if (/SELECT data FROM oauth_handshakes/.test(sql)) {
      const h = handshakes.find((x) => x.user_id === p[0] && x.platform === p[1] && x.state_key === p[2] && x.expires_at > p[3]);
      return { rows: h ? [{ data: h.data }] : [], rowCount: h ? 1 : 0 };
    }
    if (/DELETE FROM oauth_handshakes/.test(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT provider_user_id, display_name, credentials, meta/.test(sql)) {
      const c = connections.get(p[0]);
      return { rows: c && !c.disconnected_at ? [c] : [], rowCount: c ? 1 : 0 };
    }
    if (/UPDATE platform_connections SET credentials/.test(sql)) {
      const c = connections.get(p[0]);
      if (c) c.credentials = typeof p[2] === 'string' ? JSON.parse(p[2]) : p[2];
      return { rows: c ? [{ id: 'x' }] : [], rowCount: c ? 1 : 0 };
    }
    if (/UPDATE platform_connections SET disconnected_at/.test(sql)) {
      const c = connections.get(p[0]);
      if (c && !c.disconnected_at) { c.disconnected_at = p[1]; return { rows: [{ id: 'x' }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected SQL in test: ${sql.slice(0, 80)}`);
  },
};

// ── mocked Canva API + media service ──
let calls, profileStatus, exportFails, mediaSaves;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(6000)]);
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push(`${init.method ?? 'GET'} ${url}`);
  const reply = (status, body) => new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status });
  if (url.endsWith('/users/me/profile')) return profileStatus === 200 ? reply(200, { profile: { display_name: 'Ada Designer' } }) : reply(profileStatus, {});
  if (url.endsWith('/exports') && init.method === 'POST') return exportFails ? reply(500, {}) : reply(200, { job: { id: 'job1', status: 'in_progress' } });
  if (url.endsWith('/exports/job1')) return reply(200, { job: { id: 'job1', status: 'success', urls: ['https://download.test/design.png'] } });
  if (url === 'https://download.test/design.png') return reply(200, new Uint8Array(PNG));
  if (url === 'http://media.test/internal/assets') { mediaSaves++; return reply(201, { asset: { id: `asset-${mediaSaves}`, filename: 'canva-D1.png' } }); }
  if (url.includes('/oauth/revoke')) return reply(200, {});
  throw new Error(`unexpected fetch in test: ${url}`);
};

const route = createCanvaRouter(pool);
async function call(pathname, { method = 'GET', user = 'user-a', body } = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url: `/canva${pathname}`, headers: user ? { 'x-actor-user-id': user } : {} });
  let status = 0, headers = {}, raw = '';
  const res = { writeHead(s, h) { status = s; headers = h ?? {}; }, end(b) { raw = b ?? ''; } };
  await route(pathname, req, res, { requestId: 't', isHttps: true });
  return { status, headers, body: raw ? JSON.parse(raw) : null };
}
function connect(user, creds = {}) {
  connections.set(user, {
    provider_user_id: `canva-${user}`, display_name: 'Ada', meta: {},
    credentials: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, scope: 'design:content:read', ...creds },
    disconnected_at: null,
  });
}
const ready = (user, readyId, designId) =>
  handshakes.push({ id: readyId, user_id: user, platform: 'canva', state_key: `ready:${readyId}`, data: { designId }, expires_at: new Date(Date.now() + 3_600_000).toISOString() });

beforeEach(() => {
  handshakes = []; connections = new Map(); calls = []; profileStatus = 200; exportFails = false; mediaSaves = 0;
  process.env.CANVA_CLIENT_ID = 'test-client'; process.env.CANVA_CLIENT_SECRET = 'test-secret';
});

test('status: not configured → configured:false, so the UI hides Canva', async () => {
  delete process.env.CANVA_CLIENT_SECRET;
  const r = await call('/status');
  assert.deepEqual(r.body, { connected: false, configured: false });
});

test('status: configured but not connected → offered (no configured:false)', async () => {
  const r = await call('/status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { connected: false });
});

test('status: connected → name from Canva; a revoked token → reconnect required', async () => {
  connect('user-a');
  assert.deepEqual((await call('/status')).body, { connected: true, displayName: 'Ada Designer' });
  profileStatus = 401;
  assert.deepEqual((await call('/status')).body, { connected: false, reason: 'RECONNECT_REQUIRED' });
});

test('status: an expired token with no refresh token → reconnect required', async () => {
  connect('user-a', { expiresAt: Date.now() - 1000, refreshToken: undefined });
  assert.deepEqual((await call('/status')).body, { connected: false, reason: 'RECONNECT_REQUIRED' });
});

test('unauthenticated requests are refused', async () => {
  for (const [p, m] of [['/status', 'GET'], ['/export', 'POST'], ['/disconnect', 'POST']]) {
    assert.equal((await call(p, { method: m, user: null })).status, 401, p);
  }
});

test('import: exports the design, saves it to the asset gallery once, and returns it', async () => {
  connect('user-a');
  ready('user-a', 'r1', 'D1');
  const r = await call('/export', { method: 'POST', body: { readyId: 'r1' } });
  assert.equal(r.status, 200);
  assert.match(r.body.image, /^data:image\/png;base64,/);
  assert.deepEqual(r.body.asset, { id: 'asset-1', filename: 'canva-D1.png' });
  assert.equal(mediaSaves, 1);
});

test('import: a second import of the same design (double click, second tab) is refused and saves nothing', async () => {
  connect('user-a');
  ready('user-a', 'r1', 'D1');
  const [a, b] = await Promise.all([
    call('/export', { method: 'POST', body: { readyId: 'r1' } }),
    call('/export', { method: 'POST', body: { readyId: 'r1' } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(mediaSaves, 1);
  const again = await call('/export', { method: 'POST', body: { readyId: 'r1' } });
  assert.equal(again.status, 404);
});

test("import: another user's design cannot be imported", async () => {
  connect('user-a'); connect('user-b');
  ready('user-a', 'r1', 'D1');
  const r = await call('/export', { method: 'POST', body: { readyId: 'r1' }, user: 'user-b' });
  assert.equal(r.status, 404);
  assert.equal(mediaSaves, 0);
});

test('import: a Canva export failure is reported with a code and leaves the design importable', async () => {
  connect('user-a');
  ready('user-a', 'r1', 'D1');
  exportFails = true;
  const r = await call('/export', { method: 'POST', body: { readyId: 'r1' } });
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, 'CANVA_EXPORT_FAILED');
  exportFails = false;
  assert.equal((await call('/export', { method: 'POST', body: { readyId: 'r1' } })).status, 200);
});

test('disconnect: revokes at Canva and removes the connection; status then reports disconnected', async () => {
  connect('user-a');
  const r = await call('/disconnect', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.ok(calls.some((c) => c.includes('/oauth/revoke')));
  assert.deepEqual((await call('/status')).body, { connected: false });
});
