// Times /api/whapi/destinations end to end and checks the result is complete.
// Cold (refresh=1) vs cached, plus the destination counts.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { SignJWT } from 'jose';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
const { rows } = await c.query("SELECT id, session_version FROM users WHERE role='USER' AND status='ACTIVE' LIMIT 1");
await c.end();
const token = await new SignJWT({ userId: rows[0].id, sessionVersion: rows[0].session_version })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('20m')
  .sign(new TextEncoder().encode(env.SESSION_SECRET));

const hit = async (qs) => {
  const s = Date.now();
  const r = await fetch(`http://localhost:3001/api/whapi/destinations${qs}`, {
    headers: { Cookie: `sp_session=${token}` },
  });
  const j = await r.json().catch(() => ({}));
  return { ms: Date.now() - s, status: r.status, j };
};

const cold = await hit('?refresh=1');
console.log(`COLD  ${String(cold.ms).padStart(6)}ms  ${cold.status}  ${JSON.stringify(cold.j.counts)}`);

const warm = await hit('');
console.log(`CACHED ${String(warm.ms).padStart(6)}ms  ${warm.status}  ${JSON.stringify(warm.j.counts)}`);

const k = cold.j.counts || {};
const problems = [];
if (!(k.group > 0)) problems.push('groups came back empty (the /groups count=500 reset bug)');
if (!(k.community > 0)) problems.push('no communities');
if (!(k.chat > 0)) problems.push('no chats');
const commsWithoutSendId = (cold.j.destinations || []).filter((d) => d.type === 'community' && !d.sendId);
if (commsWithoutSendId.length) problems.push(`${commsWithoutSendId.length} communities missing sendId`);
if (warm.ms > 3000) problems.push(`cache not effective (${warm.ms}ms)`);

console.log(problems.length ? 'PROBLEMS:\n - ' + problems.join('\n - ') : 'all checks passed');
process.exit(problems.length ? 1 : 0);
