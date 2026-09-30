// Dumps what the WhatsApp destination picker actually renders.
import { chromium } from 'playwright';
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
await ctx.addCookies([{ name: 'sp_session', value: token, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();

const api = [];
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (/whapi\/groups|whatsapp\/communities|whatsapp\/status/.test(u.pathname)) {
    api.push(`${u.pathname} -> ${r.status()}`);
  }
});

await page.goto('http://localhost:3001/content-studio', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// click the "Load WhatsApp chats" / refresh control if present
const load = page.getByRole('button', { name: /load whatsapp chats/i }).first();
if (await load.count()) { await load.click(); await page.waitForTimeout(20000); }
else {
  const refresh = page.locator('button[title*="Refresh WhatsApp"]').first();
  if (await refresh.count()) { await refresh.click(); await page.waitForTimeout(20000); }
}

const info = await page.evaluate(() => {
  const sel = document.querySelector('select');
  if (!sel) return { error: 'no select found' };
  const groups = [];
  for (const og of sel.querySelectorAll('optgroup')) {
    groups.push({ label: og.label, count: og.children.length });
  }
  const bare = [...sel.querySelectorAll('option')].length;
  const disabled = [...sel.querySelectorAll('option')].filter((o) => o.disabled).length;
  return {
    multiple: sel.multiple,
    totalOptions: bare,
    disabledOptions: disabled,
    optgroups: groups,
    firstOptions: [...sel.querySelectorAll('option')].slice(0, 5).map((o) => o.textContent),
  };
});
console.log('api calls:', JSON.stringify(api, null, 1));
console.log('picker:', JSON.stringify(info, null, 2));
await page.screenshot({ path: '/tmp/whatsapp-picker.png' });
await browser.close();
