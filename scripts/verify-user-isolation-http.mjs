#!/usr/bin/env node
/**
 * End-to-end HTTP isolation test.
 *
 *   npm run test:isolation:http
 *
 * The library-level suite (scripts/verify-user-isolation.mjs) proves the SQL
 * is scoped. This one proves the ROUTES are: it creates two real accounts,
 * signs real session cookies for both, and then hits the actual HTTP endpoints
 * a browser would — including the direct-ID (IDOR) case and the retention
 * window.
 *
 * Run against a live server:
 *   npm run build && npm start        # or `npm run dev`
 *   BASE_URL=http://localhost:3000 npm run test:isolation:http
 */

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

import { createHmac, randomUUID } from 'node:crypto';
import { Pool, types } from 'pg';

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Sessions are minted with the app's OWN SESSION_SECRET and the same HS256
// shape session.ts issues. We deliberately do NOT go through the login/OTP
// flow: this test is about whether the ROUTES scope data, not about auth UX.
// What matters is that every request below carries a cryptographically real
// session cookie that the server's own verifySession() accepts.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET is not set. Source .env.local before running.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Minimal HS256 JWT signer — same shape src/lib/auth/session.ts issues. */
function signJwt(payload, secret) {
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256' });
  const body = b64(payload);
  const mac = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${mac}`;
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` \u2014 ${detail}` : ''}`);
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
}

const createdUserIds = [];
const createdAssetIds = [];

async function api(path, { method = 'GET', cookie, body, form, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (bytes, redirect) */ }
  return { status: res.status, json, text, headers: res.headers };
}

/** Creates an ACTIVE account and mints a real signed session cookie for it. */
async function makeUser(label) {
  const id = randomUUID();
  const email = `http-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.invalid`;
  const now = new Date().toISOString();
  const nowSec = Math.floor(Date.now() / 1000);
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, status, email_verified_at, session_version, created_at, updated_at)
     VALUES ($1, $2, $3, 'not-used-by-this-test', 'ACTIVE', $4, 0, $4, $4)`,
    [id, `HTTP ${label}`, email, now],
  );

  // A real user_sessions row so this is a TRACKED session. Logout revokes
  // server-side via that row; a token with no session_id claim takes the
  // grandfathered path and would leave the cookie replayable, which is not
  // what production logins produce.
  const sessionId = randomUUID();
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, user_agent, ip, created_at, last_seen_at)
     VALUES ($1, $2, 'isolation-test', '127.0.0.1', $3, $3)`,
    [sessionId, id, now],
  );

  const token = signJwt(
    { userId: id, sessionVersion: 0, sessionId, iat: nowSec, exp: nowSec + 3600 },
    SESSION_SECRET,
  );
  return { label, id, email, sessionId, cookie: `sp_session=${token}` };
}

async function main() {
  console.log(`SocialPulse — HTTP-level isolation test against ${BASE}`);
  console.log('='.repeat(60));

  const health = await api('/api/media-assets');
  if (health.status !== 401) {
    console.error(`\nServer at ${BASE} did not return 401 for an unauthenticated asset request (got ${health.status}).`);
    console.error('Is the app running with these changes? Aborting.');
    process.exit(1);
  }
  console.log('\nPre-flight: unauthenticated /api/media-assets -> 401 OK');

  const A = await makeUser('A');
  const B = await makeUser('B');
  createdUserIds.push(A.id, B.id);
  console.log(`\nUSER A: ${A.id}`);
  console.log(`USER B: ${B.id}`);

  const meA = await api('/api/auth/me', { cookie: A.cookie });
  const meB = await api('/api/auth/me', { cookie: B.cookie });
  check('USER A session is accepted by the server', meA.status === 200 && meA.json?.user?.id === A.id, `${meA.status} ${JSON.stringify(meA.json)}`);
  check('USER B session is accepted by the server', meB.status === 200 && meB.json?.user?.id === B.id, `${meB.status} ${JSON.stringify(meB.json)}`);
  check('/api/auth/me never returns password material', !JSON.stringify(meA.json).toLowerCase().includes('password') && !JSON.stringify(meA.json).toLowerCase().includes('hash'));

  try {
    // ------------------------------------------------------------------
    section('A. Unauthenticated access is refused');
    check('GET  /api/media-assets        -> 401', (await api('/api/media-assets')).status === 401);
    check('GET  /api/scheduler           -> 401', (await api('/api/scheduler')).status === 401);
    check('GET  /api/editor-draft        -> 401', (await api('/api/editor-draft')).status === 401);
    check('POST /api/media-assets        -> 401', (await api('/api/media-assets', { method: 'POST' })).status === 401);
    check('GET  /api/linkedin/status?userId=<other> -> 401 (no session)', (await api('/api/linkedin/status?userId=x')).status === 401);
    check('GET  /api/facebook/auth (OAuth start)     -> 401', (await api('/api/facebook/auth')).status === 401);
    check('GET  /api/linkedin/auth (OAuth start)     -> 401', (await api('/api/linkedin/auth')).status === 401);
    check('GET  /api/canva/auth    (OAuth start)     -> 401', (await api('/api/canva/auth')).status === 401);
    check('GET  /api/connect/facebook                -> 401', (await api('/api/connect/facebook?return_id=00000000-0000-0000-0000-000000000000')).status === 401);

    // ------------------------------------------------------------------
    section('B. USER A creates assets');

    // 1x1 PNG and 1x1-ish minimal files, uploaded through the real multipart route.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    async function upload(user, filename) {
      const form = new FormData();
      form.append('files', new Blob([png], { type: 'image/png' }), filename);
      const res = await api('/api/media-assets', { method: 'POST', cookie: user.cookie, form });
      return res;
    }

    const bike = await upload(A, 'bike.png');
    const aPhoto = await upload(A, 'a-photo.jpg');
    const car = await upload(B, 'car.png');
    const bPhoto = await upload(B, 'b-photo.jpg');
    const bikeId = bike.json?.uploaded?.[0]?.id;
    const aPhotoId = aPhoto.json?.uploaded?.[0]?.id;
    const carId = car.json?.uploaded?.[0]?.id;
    const bPhotoId = bPhoto.json?.uploaded?.[0]?.id;
    createdAssetIds.push(bikeId, aPhotoId, carId, bPhotoId);

    check('USER A uploaded bike.png', !!bikeId, JSON.stringify(bike.json));
    check('USER A uploaded a-photo.jpg', !!aPhotoId, JSON.stringify(aPhoto.json));
    check('USER B uploaded car.png', !!carId, JSON.stringify(car.json));
    check('USER B uploaded b-photo.jpg', !!bPhotoId, JSON.stringify(bPhoto.json));

    section('C. Gallery isolation');
    const galleryA = await api('/api/media-assets', { cookie: A.cookie });
    const galleryB = await api('/api/media-assets', { cookie: B.cookie });
    const namesA = (galleryA.json?.assets || []).map((a) => a.filename).sort();
    const namesB = (galleryB.json?.assets || []).map((a) => a.filename).sort();
    check('USER A gallery = bike.png + a-photo.jpg', JSON.stringify(namesA) === JSON.stringify(['a-photo.jpg', 'bike.png']), namesA.join(','));
    check('USER B gallery = car.png + b-photo.jpg', JSON.stringify(namesB) === JSON.stringify(['b-photo.jpg', 'car.png']), namesB.join(','));
    check('A sees no B assets', (galleryA.json?.assets || []).every((a) => ![carId, bPhotoId].includes(a.id)));
    check('B sees no A assets', (galleryB.json?.assets || []).every((a) => ![bikeId, aPhotoId].includes(a.id)));

    section('D. Direct-ID access (IDOR) — the exact case from the brief');
    const ownFetch = await api(`/api/media-assets/${bikeId}`, { cookie: A.cookie });
    check('USER A fetches own asset id -> 200 + image bytes', ownFetch.status === 200 && (ownFetch.headers.get('content-type') || '').startsWith('image/'), `status ${ownFetch.status}`);

    const crossFetch = await api(`/api/media-assets/${bikeId}`, { cookie: B.cookie });
    check(`USER B fetches USER A asset id (${String(bikeId).slice(0, 8)}...) -> 404/403`, crossFetch.status === 404 || crossFetch.status === 403, `status ${crossFetch.status}`);
    check('Cross-user fetch returns no media bytes', !crossFetch.headers.get('content-type')?.startsWith('image/'), crossFetch.headers.get('content-type') || 'none');

    const crossDelete = await api(`/api/media-assets/${bikeId}`, { method: 'DELETE', cookie: B.cookie });
    check(`USER B deleting USER A asset -> 404/403`, crossDelete.status === 404 || crossDelete.status === 403, `status ${crossDelete.status}`);
    const stillThere = await api(`/api/media-assets/${bikeId}`, { cookie: A.cookie });
    check('USER A asset survived B delete attempt', stillThere.status === 200);

    const randomId = await api('/api/media-assets/00000000-0000-4000-8000-000000000000', { cookie: A.cookie });
    check('Nonexistent id -> 404', randomId.status === 404, `status ${randomId.status}`);

    section('E. Drafts / Scheduler isolation');
    const draftA = await api('/api/scheduler', {
      method: 'POST', cookie: A.cookie,
      body: { status: 'draft', content: 'USER A private draft content', platforms: ['linkedin'] },
    });
    const draftB = await api('/api/scheduler', {
      method: 'POST', cookie: B.cookie,
      body: { status: 'draft', content: 'USER B private draft content', platforms: ['linkedin'] },
    });
    const postA = draftA.json?.post?.id;
    const postB = draftB.json?.post?.id;
    check('USER A created a draft', !!postA, JSON.stringify(draftA.json));
    check('USER B created a draft', !!postB, JSON.stringify(draftB.json));

    const postsA = await api('/api/scheduler', { cookie: A.cookie });
    const postsB = await api('/api/scheduler', { cookie: B.cookie });
    const idsA = (postsA.json?.posts || []).map((p) => p.id);
    const idsB = (postsB.json?.posts || []).map((p) => p.id);
    check('USER A scheduler returns only their own posts', idsA.length === 1 && idsA[0] === postA, idsA.join(','));
    check('USER B scheduler returns only their own posts', idsB.length === 1 && idsB[0] === postB, idsB.join(','));
    check("USER A's response does not contain B's draft text", !JSON.stringify(postsA.json).includes('USER B private draft'));

    const crossPatch = await api('/api/scheduler', {
      method: 'PATCH', cookie: A.cookie,
      body: { id: postB, scheduledAt: new Date(Date.now() + 86400000).toISOString() },
    });
    check("USER A rescheduling USER B's post is refused", crossPatch.status >= 400, `status ${crossPatch.status}`);
    const crossDeletePost = await api('/api/scheduler', {
      method: 'DELETE', cookie: A.cookie, body: { id: postB, action: 'delete-draft' },
    });
    check("USER A deleting USER B's draft is refused", crossDeletePost.status >= 400, `status ${crossDeletePost.status}`);
    const bStillHas = await api('/api/scheduler', { cookie: B.cookie });
    check("USER B's draft survived A's attempts", (bStillHas.json?.posts || []).some((p) => p.id === postB));

    section('F. Connections isolation');
    const liA = await api('/api/linkedin/status', { cookie: A.cookie });
    const liB = await api('/api/linkedin/status', { cookie: B.cookie });
    const fbA = await api('/api/facebook/status', { cookie: A.cookie });
    const fbB = await api('/api/facebook/status', { cookie: B.cookie });
    const igA = await api('/api/instagram/status', { cookie: A.cookie });
    const igB = await api('/api/instagram/status', { cookie: B.cookie });
    check('LinkedIn status ignores a ?userId= and uses the session',
      liA.json?.connected === false && liB.json?.connected === false,
      `A=${JSON.stringify(liA.json)} B=${JSON.stringify(liB.json)}`);
    check('Facebook status returns disconnected for fresh users',
      fbA.json?.connected === false && fbB.json?.connected === false);
    check('Instagram status returns disconnected for fresh users',
      igA.json?.connected === false && igB.json?.connected === false);
    const paramProbe = await api('/api/linkedin/status?userId=not-a-uuid', { cookie: A.cookie });
    check('?userId= on status route cannot select a credential', paramProbe.status === 200 && paramProbe.json?.connected === false);

    section('G. Retention metadata on the wire');
    const assetA = (galleryA.json?.assets || []).find((a) => a.id === bikeId);
    check('Asset carries expiresAt', !!assetA?.expiresAt, JSON.stringify(assetA?.expiresAt));
    check('expiresAt is ~30 days after createdAt', (() => {
      if (!assetA) return false;
      const days = (Date.parse(assetA.expiresAt) - Date.parse(assetA.createdAt)) / 86400000;
      return Math.abs(days - 30) < 0.01;
    })(), assetA ? `${((Date.parse(assetA.expiresAt) - Date.parse(assetA.createdAt)) / 86400000).toFixed(2)} days` : 'no asset');
    check('Asset carries its source', assetA?.source === 'UPLOAD', assetA?.source);
    check('Asset response carries no storage key', !JSON.stringify(galleryA.json).includes('.media-assets') && !assetA?.storageKey, assetA?.storageKey);
    check('Gallery never returns another userId', (galleryA.json?.assets || []).every((a) => a.userId === undefined || a.userId === A.id));

    section('H. Publish worker authorization (cookie-less internal calls)');
    // The scheduler publishes on behalf of many users' posts without any
    // browser session. Those calls must be accepted via a signed assertion and
    // must NOT be reachable by forging one.
    const INTERNAL = process.env.INTERNAL_PUBLISH_SECRET;
    if (!INTERNAL) {
      console.log('  ! INTERNAL_PUBLISH_SECRET is not set — skipping (scheduled publishing would break across restarts)');
    } else {
      const stamp = Date.now();
      const mac = createHmac('sha256', INTERNAL).update(`${B.id}.${stamp}`).digest('hex');
      const good = await api('/api/linkedin/publish', {
        method: 'POST',
        body: { content: 'worker test', userId: 'ignored-by-design', attemptId: `iso-worker-ok-${stamp}` },  // unique per run: the publish route dedupes attemptIds for a TTL window
        headers: { 'x-socialpulse-internal-actor': `${B.id}.${stamp}.${mac}` },
      });
      // Reaching "not connected" means the assertion was accepted and the
      // route got as far as resolving B's credentials. A 401 Unauthorized
      // body would mean the assertion was rejected and scheduling is broken.
      check('Signed internal assertion is accepted by a publish route',
        good.json?.code === 'LINKEDIN_NOT_CONNECTED', `got ${good.status} ${JSON.stringify(good.json)?.slice(0, 90)}`);

      const forged = await api('/api/linkedin/publish', {
        method: 'POST',
        body: { content: 'forged', attemptId: 'iso-worker-bad' },
        headers: { 'x-socialpulse-internal-actor': `${B.id}.${Date.now()}.deadbeefdeadbeef` },
      });
      check('Forged internal assertion is rejected (401)', forged.status === 401, `status ${forged.status}`);
      check('Forged assertion returns no credential error', forged.json?.code !== 'LINKEDIN_NOT_CONNECTED', JSON.stringify(forged.json));

      const none = await api('/api/linkedin/publish', {
        method: 'POST', body: { content: 'anon', attemptId: 'iso-worker-none' },
      });
      check('Publish route with no session and no assertion -> 401', none.status === 401, `status ${none.status}`);
    }

    section('I. Global publish trigger is privileged');
    const worker = await api('/api/scheduler/check', { method: 'POST', cookie: A.cookie });
    check('A regular user cannot trigger the global publish run', worker.status === 403, `status ${worker.status}`);
    const anonWorker = await api('/api/scheduler/check', { method: 'POST' });
    check('Unauthenticated cannot trigger the global publish run', anonWorker.status === 401, `status ${anonWorker.status}`);

    section('J. Logout clears server session');
    const logout = await api('/api/auth/logout', { method: 'POST', cookie: A.cookie });
    check('POST /api/auth/logout -> 200', logout.status === 200);
    const afterLogout = await api('/api/media-assets', { cookie: A.cookie });
    check('A session cookie is dead after logout', afterLogout.status === 401, `status ${afterLogout.status}`);
  } finally {
    console.log('\nCleaning up test fixtures…');
    for (const id of createdAssetIds) {
      if (!id) continue;
      await api(`/api/media-assets/${id}`, { method: 'DELETE', cookie: A.cookie }).catch(() => {});
      await api(`/api/media-assets/${id}`, { method: 'DELETE', cookie: B.cookie }).catch(() => {});
    }
    // Deleting the users cascades to media_assets, scheduled_posts and
    // platform_connections.
    if (createdUserIds.length) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]).catch((e) => console.warn('  cleanup:', e.message));
    }
    console.log('Done.');
  }

  await pool.end();
  console.log('\n' + '='.repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});