// Observes the WhatsApp connect modal + whether status polling actually runs.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { SignJWT } from 'jose';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(
  "SELECT id, session_version FROM users WHERE role='USER' AND status='ACTIVE' LIMIT 1",
);
await c.end();
const token = await new SignJWT({ userId: rows[0].id, sessionVersion: rows[0].session_version })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m')
  .sign(new TextEncoder().encode(env.SESSION_SECRET));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: 'sp_session', value: token, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();

const statusCalls = [];
const statusBodies = [];
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/whatsapp/status')) statusCalls.push(Date.now());
});
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/whatsapp/status')) {
    let b = {};
    try { b = await r.json(); } catch {}
    statusBodies.push({ http: r.status(), body: b });
  }
});
const connectCalls = [];
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (u.pathname === '/api/whatsapp/connect') {
    let body = {};
    try { body = await r.json(); } catch {}
    connectCalls.push({ status: r.status(), keys: Object.keys(body), hasQr: !!body.qrImage, bodyStatus: body.status });
  }
});

await page.goto('http://localhost:3001/connect-platforms', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// open the WhatsApp card / connect button
const btn = page.getByRole('button', { name: /whatsapp/i }).first();
if (await btn.count()) { await btn.click().catch(() => {}); }
await page.waitForTimeout(500);
const connectBtn = page.getByRole('button', { name: /connect whatsapp|try again|refresh qr/i }).first();
if (await connectBtn.count()) await connectBtn.click().catch(() => {});

console.log('connect calls:', JSON.stringify(connectCalls, null, 2));
await page.waitForTimeout(11000);
const gaps = statusCalls.slice(1).map((t, i) => Math.round((t - statusCalls[i]) / 1000));
console.log('status polls:', statusCalls.length);
console.log('gaps (s):', JSON.stringify(gaps));
console.log('poll responses (unique):', JSON.stringify(
  [...new Map(statusBodies.map((x) => [JSON.stringify(x), x])).values()], null, 2,
));
// did the modal close itself?
const modalGone = !(await page.getByText(/Waiting for scan/i).count());
console.log('modal auto-closed after scan wait:', modalGone);
await page.screenshot({ path: '/tmp/whatsapp-connect.png' });
await browser.close();
