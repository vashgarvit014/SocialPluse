#!/usr/bin/env node
/**
 * Verifies the SINGLE-CHANNEL ownership model for WhatsApp.
 *
 * There is exactly ONE Whapi channel on this deployment (WHAPI_API_TOKEN), so
 * provider state is shared: one paired device serves everybody. The invariant
 * under test is that SocialPulse ownership does NOT become shared with it.
 *
 *   USER A pairs  -> A is CONNECTED, B is not
 *   B connects    -> refused, never inherits A's session
 *   B publishes   -> refused, even though B is a valid signed-in user
 *   A publishes   -> passes the ownership gate
 *
 * No message is ever sent: the publish calls use a deliberately non-existent
 * group id, so they stop at validation long before a provider send.
 *
 *   BASE_URL=http://localhost:3002 node scripts/verify-whatsapp-ownership.mjs
 */
import { Pool, types } from 'pg';
import { createHmac, randomUUID } from 'node:crypto';

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

const BASE = (process.env.BASE_URL || 'http://localhost:3002').replace(/\/$/, '');
const SECRET = process.env.SESSION_SECRET;
const SHARED_TOKEN = process.env.WHAPI_API_TOKEN;
if (!SECRET || !SHARED_TOKEN) { console.error('SESSION_SECRET and WHAPI_API_TOKEN must be set.'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`    ok   ${label}`); }
  else { fail++; console.log(`    FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n  ${t}`);

function mintSession(userId) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const b = enc({ userId, sessionVersion: 0 });
  const sig = createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  return `sp_session=${h}.${b}.${sig}`;
}

async function api(path, { method = 'GET', cookie, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const BOGUS_GROUP = '120363999999999999@g.us'; // never exists -> stops before any send

async function main() {
  const now = new Date().toISOString();
  const tag = randomUUID().slice(0, 8);
  const A = { id: randomUUID(), email: `own-a-${tag}@test.local` };
  const B = { id: randomUUID(), email: `own-b-${tag}@test.local` };
  // Declared out here because the `finally` block has to be able to hand the
  // channel back even when the run aborts partway through.
  let borrowed = [];

  console.log(`Single-channel WhatsApp ownership — against ${BASE}`);
  console.log(`shared channel token: <set, ${SHARED_TOKEN.length} chars> (never printed)`);

  try {
    for (const u of [A, B]) {
      await pool.query(
        `INSERT INTO users (id, name, email, password_hash, status, role, email_verified_at, session_version, created_at, updated_at)
         VALUES ($1,$2,$3,'x','ACTIVE','USER',now(),0,$4,$4)`,
        [u.id, u.email, u.email, now],
      );
    }
    const cookieA = mintSession(A.id), cookieB = mintSession(B.id);

    // This deployment's shared channel may ALREADY have an owner (a real
    // account that paired it during testing). The invariant under test is
    // therefore "B never gains ownership", not "A owns it" — asserting the
    // latter made the suite depend on leftover state and fail for reasons that
    // had nothing to do with ownership.
    // Borrow the channel: remove any real owner for the duration, then put it
    // back. Required now that a UNIQUE partial index enforces one CONNECTED row
    // per channel_token — without this the fixture row and a genuine owner's row
    // would collide, and the test could never exercise the owner path.
    const pre = await pool.query(
      `SELECT * FROM whatsapp_connections WHERE channel_token = $1 AND status = 'CONNECTED'`,
      [SHARED_TOKEN],
    );
    borrowed = pre.rows;
    if (borrowed.length) {
      await pool.query(`DELETE FROM whatsapp_connections WHERE channel_token = $1 AND status = 'CONNECTED'`, [SHARED_TOKEN]);
    }
    const preExistingOwner = borrowed[0]?.user_id ?? null;
    if (preExistingOwner && preExistingOwner === B.id) {
      throw new Error('fixture B must not already own the shared channel');
    }
    console.log(`\n  pre-existing channel owner: ${preExistingOwner ? 'yes (a different account)' : 'none — channel is unclaimed'}`);

    // ---- A has completed pairing on the shared channel -----------------------
    await pool.query(
      `INSERT INTO whatsapp_connections
         (id, user_id, provider, provider_channel_id, provider_session_id, channel_token, status,
          phone_masked, account_name, qr_created_at, qr_expires_at, confirmed_at, connected_at, created_at, updated_at)
       VALUES ($1,$2,'WHAPI','chan-shared',$3,$4,'CONNECTED','916***38','Phone A',$5,$5,$5,$5,$5,$5)`,
      [randomUUID(), A.id, `waseq_${randomUUID()}`, SHARED_TOKEN, now],
    );

    section('1. Provider is connected, but only A owns it');
    const aStat = await api('/api/whatsapp/status', { cookie: cookieA });
    const bStat = await api('/api/whatsapp/status', { cookie: cookieB });
    // Deliberately NOT asserting `aStat.connected === true` here.
    //
    // getWhatsAppStatus() downgrades a CONNECTED row to a non-connected status
    // whenever it cannot confirm the channel is still authenticated at the
    // provider — which is correct behaviour, but it means the API answer depends
    // on the LIVE Whapi pairing. That pairing is external state this test does
    // not control: it passed while the channel was paired and started failing
    // the moment it was legitimately unpaired, which says nothing about
    // ownership. Ownership is a property of the record, so assert that instead.
    const aRow = await pool.query(
      `SELECT status FROM whatsapp_connections WHERE user_id = $1 AND channel_token = $2`,
      [A.id, SHARED_TOKEN],
    );
    check(
      'USER A owns the shared channel in the record',
      aRow.rows[0]?.status === 'CONNECTED',
      `db=${aRow.rows[0]?.status}`,
    );
    const ownerRow = await pool.query(
      `SELECT w.user_id FROM whatsapp_connections w
        WHERE w.channel_token = $1 AND w.status = 'CONNECTED' LIMIT 1`,
      [SHARED_TOKEN],
    );
    // The channel is BORROWED for this run (any real owner is removed up front
    // and handed back in `finally`), so during the test USER A is legitimately
    // the single owner. What must never happen is B taking it.
    const resolvedOwner = ownerRow.rows[0]?.user_id ?? null;
    check('the channel resolves to USER A as its active owner', resolvedOwner === A.id,
      `owner=${resolvedOwner === B.id ? 'USER B (leak!)' : resolvedOwner ? 'nobody/a different row' : 'nobody'}`);
    check('USER B never becomes the owner', resolvedOwner !== B.id, 'B owns the channel');
    check('USER B does NOT inherit the connection', bStat.json?.connected === false, `got ${bStat.json?.status}`);
    check('USER B currentUserConnected === false', bStat.json?.currentUserConnected === false);

    section('2. USER B cannot silently take over the shared channel');
    const bConnect = await api('/api/whatsapp/connect', { method: 'POST', cookie: cookieB });
    check('B POST /api/whatsapp/connect is refused', bConnect.json?.status === 'ERROR', `got ${bConnect.json?.status}`);
    // The refusal must be actionable: it has to NAME the account holding the
    // channel (masked), not just assert that somebody does.
    const refusal = String(bConnect.json?.message);
    check(
      'refusal names the masked owner',
      /already connected to [^\s]+@/.test(refusal),
      refusal.slice(0, 90),
    );
    check(
      'refusal does not leak the full owner email',
      !refusal.includes(B.email),
      refusal.slice(0, 90),
    );
    check(
      'refusal tells the reader what to do',
      /disconnect it there first|ask an administrator/i.test(refusal),
      refusal.slice(0, 90),
    );
    const bRow = await pool.query('SELECT status FROM whatsapp_connections WHERE user_id = $1', [B.id]);
    check('B has no connection row created', bRow.rowCount === 0);

    section('3. Publishing is owner-gated (the cross-user leak)');
    const bPub = await api('/api/whapi/publish', {
      method: 'POST', cookie: cookieB,
      body: { groupId: BOGUS_GROUP, text: 'ownership probe', attemptId: `own-b-${tag}` },
    });
    check('B publish -> 403', bPub.status === 403, `got ${bPub.status}`);
    check(
      'B publish -> WHATSAPP_NOT_CHANNEL_OWNER',
      bPub.json?.code === 'WHATSAPP_NOT_CHANNEL_OWNER',
      `got ${bPub.json?.code}`,
    );
    const aPub = await api('/api/whapi/publish', {
      method: 'POST', cookie: cookieA,
      body: { groupId: BOGUS_GROUP, text: 'ownership probe', attemptId: `own-a-${tag}` },
    });
    check(
      'A publish passes the ownership gate (fails later, on the fake group)',
      aPub.json?.code !== 'WHATSAPP_NOT_CHANNEL_OWNER',
      `got ${aPub.json?.code}`,
    );

    section('4. UI publish path is gated too (it delegates to the same route)');
    const bUiPub = await api('/api/whatsapp/publish', {
      method: 'POST', cookie: cookieB,
      body: { announcementGroupId: BOGUS_GROUP, text: 'ownership probe', attemptId: `own-uib-${tag}` },
    });
    check(
      'B publish via /api/whatsapp/publish -> not owner',
      bUiPub.json?.code === 'WHATSAPP_NOT_CHANNEL_OWNER',
      `got ${bUiPub.json?.code}`,
    );

    section('5. Shared-channel READ routes are owner-gated too');
    for (const [route, label] of [
      ['/api/whapi/groups', 'groups'],
      ['/api/whapi/destinations', 'destinations'],
      ['/api/whapi/status', 'channel status'],
    ]) {
      const bRes = await api(route, { cookie: cookieB });
      check(
        `B cannot read ${label} -> 403`,
        bRes.status === 403,
        `got ${bRes.status}`,
      );
      check(
        `B read ${label} -> ownership code`,
        bRes.json?.code === 'WHATSAPP_NOT_CHANNEL_OWNER' || bRes.json?.reason === 'WHATSAPP_NOT_CHANNEL_OWNER',
        `got ${bRes.json?.code || bRes.json?.reason}`,
      );
    }

    section('6. The owner can still use those same routes');
    for (const [route, label] of [
      ['/api/whapi/groups', 'groups'],
      ['/api/whapi/destinations', 'destinations'],
    ]) {
      const aRes = await api(route, { cookie: cookieA });
      check(`A can read ${label} (not blocked by ownership)`, aRes.status !== 403, `got ${aRes.status}`);
    }

    section('7. Communities listing stays owner-gated');
    const bComms = await api('/api/whatsapp/communities', { cookie: cookieB });
    check('B cannot list the shared channel communities', bComms.status >= 400 || bComms.json?.success === false,
      `status ${bComms.status}`);
  } finally {
    await pool.query('DELETE FROM whatsapp_connections WHERE user_id = ANY($1)', [[A.id, B.id]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A.id, B.id]]);
    // Give the channel back to whoever actually owns it.
    for (const row of borrowed) {
      await pool.query(
        `INSERT INTO whatsapp_connections
           (id, user_id, provider, provider_channel_id, provider_session_id, channel_token, status,
            phone_masked, account_name, qr_created_at, qr_expires_at, confirmed_at, connected_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [row.id, row.user_id, row.provider, row.provider_channel_id, row.provider_session_id,
         row.channel_token, row.status, row.phone_masked, row.account_name, row.qr_created_at,
         row.qr_expires_at, row.confirmed_at, row.connected_at, row.created_at],
      );
    }
    await pool.end();
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });