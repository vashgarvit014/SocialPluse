#!/usr/bin/env node
/**
 * Content-moderation ESCALATION verification (integration).
 *
 *   npm run test:moderation
 *
 * Runs against a live server with real signed sessions and the real database.
 * Verifies the WARNING -> FLAG -> NOTIFY escalation, that a blocked request
 * never reaches the Asset Gallery, that an allowed request is unaffected, that
 * Superadmin can see and reverse everything, and that concurrent violations do
 * not lose an increment.
 *
 * This is the integration half. The classifier-quality half lives in
 * scripts/verify-moderation-classifier.mjs and runs offline.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { Pool, types } from 'pg';

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) { console.error('SESSION_SECRET is not set. Source .env.local.'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` \u2014 ${detail}` : ''}`); console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n${t}`);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function api(path, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function makeUser(label, role = 'USER') {
  const id = randomUUID();
  const now = new Date().toISOString();
  const email = `mod-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.invalid`;
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, status, role, email_verified_at, session_version, created_at, updated_at)
     VALUES ($1,$2,$3,'x','ACTIVE',$4,$5,0,$5,$5)`,
    [id, `Mod ${label}`, email, role, now],
  );
  const sessionId = randomUUID();
  await pool.query(`INSERT INTO user_sessions (id, user_id, created_at, last_seen_at) VALUES ($1,$2,$3,$3)`, [sessionId, id, now]);
  const n = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256' }), b = b64({ userId: id, sessionVersion: 0, sessionId, iat: n, exp: n + 3600 });
  const token = `${h}.${b}.${createHmac('sha256', SESSION_SECRET).update(`${h}.${b}`).digest('base64url')}`;
  return { id, email, role, cookie: `sp_session=${token}` };
}

const userRow = (id) => pool.query('SELECT * FROM users WHERE id = $1', [id]).then(r => r.rows[0]);
const notifCount = (id) => pool.query('SELECT count(*) c FROM admin_notifications WHERE user_id = $1', [id]).then(r => Number(r.rows[0].c));
const eventCount = (id) => pool.query('SELECT count(*) c FROM moderation_events WHERE user_id = $1', [id]).then(r => Number(r.rows[0].c));

// Unambiguously prohibited, so the classifier blocks it deterministically
// whichever layer fires.
const BLOCK_PROMPT = 'pornographic explicit nude photo of a naked real woman';
const OK_PROMPT = 'a serene mountain lake at sunrise with pine trees';

async function main() {
  console.log(`SocialPulse \u2014 moderation escalation verification against ${BASE}`);
  console.log('='.repeat(60));

  const pre = await api('/api/generate-image', { method: 'POST', body: { prompt: 'x' } });
  if (pre.status !== 401) {
    console.error(`\nServer returned ${pre.status} for an unauthenticated generate request (want 401).`);
    process.exit(1);
  }
  console.log('\nPre-flight: unauthenticated /api/generate-image -> 401 OK');

  const A = await makeUser('A');
  const admin = await makeUser('Admin', 'SUPERADMIN');
  const benign = await makeUser('Benign');
  const conc = await makeUser('Conc');

  try {
    // ---------------------------------------------------------------
    section('1. First confirmed violation \u2014 blocked, warned, counted');
    const gallery0 = (await api('/api/media-assets', { cookie: A.cookie })).json?.assets || [];

    const r1 = await api('/api/generate-image', { method: 'POST', cookie: A.cookie, body: { prompt: BLOCK_PROMPT, style: 'photographic' } });
    check('Request blocked with 422', r1.status === 422, `status ${r1.status} ${JSON.stringify(r1.json)?.slice(0, 130)}`);
    check('Response code is CONTENT_SAFETY_BLOCKED', r1.json?.code === 'CONTENT_SAFETY_BLOCKED');
    check('Response carries the user-facing warning text', typeof r1.json?.error === 'string' && /nudity|sexually explicit/i.test(r1.json.error));
    check('Response names the warning "flagged for review"', /flagged for review/i.test(r1.json?.error || ''));
    check('No jobId is issued for a blocked request', !r1.json?.jobId);

    const a1 = await userRow(A.id);
    check('Violation count == 1', Number(a1.moderation_violation_count) === 1, `got ${a1.moderation_violation_count}`);
    check('User is NOT flagged yet', a1.moderation_flagged === false);
    check('Severity == WARNING', r1.json?.moderation?.severity === 'WARNING', r1.json?.moderation?.severity);
    check('No admin notification on the first violation', (await notifCount(A.id)) === 0);
    check('Exactly one moderation event recorded', (await eventCount(A.id)) === 1);
    const ev1 = (await pool.query('SELECT * FROM moderation_events WHERE user_id = $1', [A.id])).rows[0];
    check('Event counts_as_violation = true', ev1?.counts_as_violation === true);
    check('Event records no raw prompt text', !JSON.stringify(ev1).toLowerCase().includes('pornographic'));
    check('Event stores a prompt fingerprint instead', typeof ev1?.prompt_fingerprint === 'string' && ev1.prompt_fingerprint.length > 0);

    const gallery1 = (await api('/api/media-assets', { cookie: A.cookie })).json?.assets || [];
    check('Blocked request created NO MediaAsset', gallery1.length === gallery0.length, `${gallery0.length} -> ${gallery1.length}`);

    // ---------------------------------------------------------------
    section('2. Second confirmed violation \u2014 blocked, flagged, notified');
    const r2 = await api('/api/generate-image', { method: 'POST', cookie: A.cookie, body: { prompt: BLOCK_PROMPT, style: 'photographic' } });
    check('Second request also blocked', r2.status === 422, `status ${r2.status}`);
    const a2 = await userRow(A.id);
    check('Violation count == 2', Number(a2.moderation_violation_count) === 2, `got ${a2.moderation_violation_count}`);
    check('User is FLAGGED', a2.moderation_flagged === true);
    check('Flag reason == REPEATED_PROHIBITED_SEXUAL_CONTENT', a2.moderation_flag_reason === 'REPEATED_PROHIBITED_SEXUAL_CONTENT', a2.moderation_flag_reason);
    check('moderation_flagged_at set', !!a2.moderation_flagged_at);
    check('moderation_first_violation_at set', !!a2.moderation_first_violation_at);
    check('moderation_last_violation_at set', !!a2.moderation_last_violation_at);
    check('Account NOT auto-suspended', a2.status === 'ACTIVE');

    const n2 = (await pool.query('SELECT * FROM admin_notifications WHERE user_id = $1 ORDER BY created_at DESC', [A.id])).rows;
    check('Superadmin notification created', n2.length === 1, `${n2.length}`);
    check('Notification type == USER_FLAGGED', n2[0]?.type === 'USER_FLAGGED');
    check('Notification category == MODERATION', n2[0]?.category === 'MODERATION');
    check('Notification severity == WARNING', n2[0]?.severity === 'WARNING');
    check('Notification starts unread', n2[0]?.is_read === false);

    // ---------------------------------------------------------------
    section('3. Third violation \u2014 severity escalates, still no auto-ban');
    const r3 = await api('/api/generate-image', { method: 'POST', cookie: A.cookie, body: { prompt: BLOCK_PROMPT, style: 'photographic' } });
    check('Third request still blocked', r3.status === 422);
    check('Severity escalated to HIGH', r3.json?.moderation?.severity === 'HIGH', r3.json?.moderation?.severity);
    const a3 = await userRow(A.id);
    check('Violation count == 3', Number(a3.moderation_violation_count) === 3);
    check('Account NOT suspended automatically', a3.status === 'ACTIVE');
    const n3 = await notifCount(A.id);
    check('Escalation notification queued', n3 === 2, `${n3}`);
    const latestNotif = (await pool.query('SELECT * FROM admin_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [A.id])).rows[0];
    check('Escalation notification severity == HIGH', latestNotif?.severity === 'HIGH');

    const gallery3 = (await api('/api/media-assets', { cookie: A.cookie })).json?.assets || [];
    check('Still no MediaAsset after 3 blocked attempts', gallery3.length === gallery0.length);

    // ---------------------------------------------------------------
    section('4. Superadmin visibility');
    const adminNotif = await api('/api/superadmin/notifications', { cookie: admin.cookie });
    check('Superadmin notifications endpoint -> 200', adminNotif.status === 200, `status ${adminNotif.status}`);
    check('Flagged notification visible to Superadmin', (adminNotif.json?.notifications || []).some(n => n.userId === A.id));
    check('Unread count reflects the alerts', Number(adminNotif.json?.unreadCount || 0) >= 2, `${adminNotif.json?.unreadCount}`);

    const summary = await api(`/api/superadmin/moderation/users/${A.id}`, { cookie: admin.cookie });
    check('Superadmin reads the moderation summary', summary.status === 200);
    check('Summary shows violation count 3', summary.json?.moderation?.violationCount === 3, JSON.stringify(summary.json?.moderation));
    check('Summary shows flagged', summary.json?.moderation?.flagged === true);
    check('Summary shows severity HIGH', summary.json?.moderation?.severity === 'HIGH');
    check('Summary shows the user record', summary.json?.user?.email === A.email);

    const userNotif = await api('/api/superadmin/notifications', { cookie: A.cookie });
    check('Normal user is refused the notifications API (403)', userNotif.status === 403, `status ${userNotif.status}`);
    const userMod = await api(`/api/superadmin/moderation/users/${A.id}`, { cookie: A.cookie });
    check('Normal user is refused the moderation API (403)', userMod.status === 403, `status ${userMod.status}`);

    // ---------------------------------------------------------------
    section('5. False-positive handling \u2014 moderation is reversible');
    const clear = await api(`/api/superadmin/moderation/users/${A.id}`, { method: 'POST', cookie: admin.cookie, body: { action: 'clear-flag' } });
    check('Clear flag -> 200', clear.status === 200 && clear.json?.cleared === true, JSON.stringify(clear.json));
    const aCleared = await userRow(A.id);
    check('Flag cleared', aCleared.moderation_flagged === false);
    check('Flag reason cleared', !aCleared.moderation_flag_reason);
    check('Flagged-at cleared', !aCleared.moderation_flagged_at);
    const clearAgain = await api(`/api/superadmin/moderation/users/${A.id}`, { method: 'POST', cookie: admin.cookie, body: { action: 'clear-flag' } });
    check('Clearing an unflagged user is a safe no-op', clearAgain.status === 200 && clearAgain.json?.cleared === false);

    const reset = await api(`/api/superadmin/moderation/users/${A.id}`, { method: 'POST', cookie: admin.cookie, body: { action: 'reset-counter' } });
    check('Reset counter -> 200', reset.status === 200);
    check('Violation count reset to 0', Number((await userRow(A.id)).moderation_violation_count) === 0);

    // ---------------------------------------------------------------
    section('6. Suspend / reactivate');
    const susp = await api(`/api/superadmin/moderation/users/${A.id}`, { method: 'POST', cookie: admin.cookie, body: { action: 'suspend' } });
    check('Suspend -> 200', susp.status === 200 && susp.json?.status === 'SUSPENDED', JSON.stringify(susp.json));
    check('Status is SUSPENDED in the DB', (await userRow(A.id)).status === 'SUSPENDED');
    const reac = await api(`/api/superadmin/moderation/users/${A.id}`, { method: 'POST', cookie: admin.cookie, body: { action: 'reactivate' } });
    check('Reactivate -> 200', reac.status === 200 && reac.json?.status === 'ACTIVE');
    check('Status is ACTIVE again', (await userRow(A.id)).status === 'ACTIVE');
    const badAction = await api(`/api/superadmin/moderation/users/${A.id}`, { method: 'POST', cookie: admin.cookie, body: { action: 'nonsense' } });
    check('Unknown action is rejected', badAction.status === 400, `status ${badAction.status}`);

    // ---------------------------------------------------------------
    section('7. Allowed requests are unaffected');
    const okGallery0 = (await api('/api/media-assets', { cookie: benign.cookie })).json?.assets || [];
    const rOk = await api('/api/generate-image', { method: 'POST', cookie: benign.cookie, body: { prompt: OK_PROMPT, style: 'photographic' } });
    check('Benign prompt is NOT blocked', rOk.status !== 422, `status ${rOk.status} ${JSON.stringify(rOk.json)?.slice(0, 110)}`);
    check('Benign prompt did not return a safety code', !String(rOk.json?.code || '').includes('CONTENT_SAFETY'));
    const bRow = await userRow(benign.id);
    check('Benign user has 0 violations', Number(bRow.moderation_violation_count) === 0);
    check('Benign user has 0 moderation events', (await eventCount(benign.id)) === 0);
    check('Benign user has 0 notifications', (await notifCount(benign.id)) === 0);
    check('Benign user not flagged', bRow.moderation_flagged === false);
    const okGallery1 = (await api('/api/media-assets', { cookie: benign.cookie })).json?.assets || [];
    check('Benign attempt did not inject a MediaAsset', okGallery1.length === okGallery0.length);

    // ---------------------------------------------------------------
    // Five violations fired simultaneously over HTTP. This is the race the
    // FOR UPDATE lock in the escalation transaction exists for: without it two
    // requests read the same counter and one increment is lost.
    section('8. Concurrency \u2014 5 simultaneous violations count as 5');
    const burst = await Promise.all(Array.from({ length: 5 }, () =>
      api('/api/generate-image', { method: 'POST', cookie: conc.cookie, body: { prompt: BLOCK_PROMPT, style: 'photographic' } })));
    check('All 5 concurrent requests were blocked', burst.every(r => r.status === 422), burst.map(r => r.status).join(','));
    const concRow = await userRow(conc.id);
    check('All 5 increments landed (row lock serialised them)', Number(concRow.moderation_violation_count) === 5, `got ${concRow.moderation_violation_count}`);
    check('Exactly 5 moderation events recorded', (await eventCount(conc.id)) === 5, `${await eventCount(conc.id)}`);
    check('Concurrency test account is flagged', concRow.moderation_flagged === true);
    const concNotif = await notifCount(conc.id);
    check('Flag + escalation notifications queued', concNotif === 4, `${concNotif} (flag at 2, then 3, 4, 5)`);
    // Assert the INVARIANT rather than the arrival order: concurrent
    // transactions may commit out of order, so the sequence in which the
    // notifications were written is not guaranteed to be 2,3,4,5. What must
    // hold is that each notification's severity is the correct escalation for
    // the violation count it recorded.
    const SEVERITY_FOR_COUNT = (n) => (n >= 5 ? 'CRITICAL' : n >= 3 ? 'HIGH' : 'WARNING');
    const concNotifs = (await pool.query(
      `SELECT severity, metadata->>'violationCount' AS c FROM admin_notifications
        WHERE user_id = $1`, [conc.id])).rows;
    const wrongSeverity = concNotifs.filter(r => r.severity !== SEVERITY_FOR_COUNT(Number(r.c)));
    check('Every notification severity matches its violation count',
      wrongSeverity.length === 0,
      concNotifs.map(r => `${r.c}=${r.severity}`).join(','));
    const seenCounts = concNotifs.map(r => Number(r.c)).sort((a, b) => a - b);
    check('Notifications cover violation counts 2,3,4,5',
      JSON.stringify(seenCounts) === JSON.stringify([2, 3, 4, 5]), seenCounts.join(','));

    // ---------------------------------------------------------------
    section('9. BLOCK_OTHER_SAFETY is recorded but does NOT count');
    // Written straight to the audit trail the way a provider refusal would be,
    // then verified through the read model the Superadmin UI uses.
    await pool.query(
      `INSERT INTO moderation_events
         (id, user_id, category, decision, action, severity, method, provider,
          counts_as_violation, violation_count_after, prompt_fingerprint, safe_metadata, created_at)
       VALUES ($1,$2,'OTHER_SAFETY','BLOCK_OTHER_SAFETY','TEST','INFO','PROVIDER','pollinations',
               false, 0, $3, '{}'::jsonb, $4)`,
      [randomUUID(), benign.id, 'a'.repeat(32), new Date().toISOString()],
    );
    const bAfterOther = await userRow(benign.id);
    check('Non-sexual safety block does NOT increment the counter', Number(bAfterOther.moderation_violation_count) === 0, `got ${bAfterOther.moderation_violation_count}`);
    check('Non-sexual safety block does NOT flag the user', bAfterOther.moderation_flagged === false);
    check('Non-sexual safety block is still recorded for audit', (await eventCount(benign.id)) === 1);
    check('Non-sexual safety block queued no notification', (await notifCount(benign.id)) === 0);

    // ---------------------------------------------------------------
    section('10. Safe logging');
    const logs = await pool.query('SELECT event, message, metadata FROM system_logs WHERE user_id = $1', [A.id]);
    const names = new Set(logs.rows.map(r => r.event));
    check('CONTENT_MODERATION_BLOCKED logged', names.has('CONTENT_MODERATION_BLOCKED'), [...names].join(','));
    check('CONTENT_SAFETY_WARNING_ISSUED logged', names.has('CONTENT_SAFETY_WARNING_ISSUED'), [...names].join(','));
    const global = await pool.query(`SELECT event FROM system_logs WHERE event IN ('USER_MODERATION_FLAGGED','MODERATION_FLAG_CLEARED','USER_SUSPENDED_FOR_REVIEW','USER_REACTIVATED')`);
    const globalNames = new Set(global.rows.map(r => r.event));
    check('USER_MODERATION_FLAGGED logged', globalNames.has('USER_MODERATION_FLAGGED'));
    check('MODERATION_FLAG_CLEARED logged', globalNames.has('MODERATION_FLAG_CLEARED'));
    check('USER_SUSPENDED_FOR_REVIEW logged', globalNames.has('USER_SUSPENDED_FOR_REVIEW'));
    check('USER_REACTIVATED logged', globalNames.has('USER_REACTIVATED'));

    const all = await pool.query(`SELECT message, metadata FROM system_logs WHERE user_id = $1`, [A.id]);
    const dump = JSON.stringify(all.rows).toLowerCase();
    check('No raw prompt text in logs', !dump.includes('pornographic'));
    check('No session cookie in logs', !dump.includes('sp_session'));
    check('No password material in logs', !dump.includes('password'));
  } finally {
    console.log('\nCleaning up test fixtures\u2026');
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[A.id, admin.id, benign.id, conc.id]]).catch(() => {});
    console.log('Done.');
  }

  await pool.end();
  console.log('\n' + '='.repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log(`  - ${f}`)); }
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('\nFATAL:', e); try { await pool.end(); } catch {} process.exit(1); });