// Verifies the destination dropdown is not clipped by the card's overflow.
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
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addCookies([{ name: 'sp_session', value: token, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

await page.goto('http://localhost:3001/content-studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const sf = page.getByRole('button', { name: /start fresh/i }).first();
if (await sf.count()) { await sf.click().catch(() => {}); await page.waitForTimeout(2500); }

await page.locator('textarea').first().fill('verifying the picker layout').catch(() => {});
await page.waitForTimeout(800);
for (let i = 0; i < 8; i++) {
  const next = page.getByRole('button', { name: /^Next/ }).first();
  if (!(await next.count()) || (await next.isDisabled().catch(() => true))) break;
  await next.click().catch(() => {});
  await page.waitForTimeout(1500);
  if (await page.getByText(/Send to:/i).count()) break;
}
console.log('reached publish step:', (await page.getByText(/Send to:/i).count()) > 0);

const trigger = page.getByText(/Select chats, groups or communities/i).first();
await trigger.click().catch(() => {});
await page.waitForTimeout(1200);

const geo = await page.evaluate(() => {
  const search = [...document.querySelectorAll('input')].find((i) => /search chats/i.test(i.placeholder || ''));
  if (!search) return { error: 'panel not open' };
  const panel = search.closest('div[style*="fixed"]') || search.parentElement?.parentElement;
  if (!panel) return { error: 'no panel' };
  const r = panel.getBoundingClientRect();
  const pos = getComputedStyle(panel).position;
  const checkboxes = panel.querySelectorAll('input[type=checkbox]').length;
  const filters = [...panel.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 6);
  return {
    position: pos,
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    height: Math.round(r.height), width: Math.round(r.width),
    withinViewport: r.top >= 0 && r.bottom <= window.innerHeight,
    checkboxesVisible: checkboxes,
    filters,
  };
});
console.log('panel:', JSON.stringify(geo, null, 1));
await page.screenshot({ path: '/tmp/picker-open.png' });
await browser.close();
process.exit(0);
