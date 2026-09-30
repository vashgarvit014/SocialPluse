// Verifies the destination dropdown is not clipped by the publish card's
// `overflow: hidden`. Mocks /api/generate-content so the wizard can advance
// to the Publish step without waiting on the real AI.
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

const cap = (p) => ({ caption: `Mock ${p} caption used to reach the publish step quickly. `.repeat(4), hashtags: ['testing', 'design'] });
const MOCK = {
  platforms: {
    linkedin: cap('LinkedIn'), instagram: cap('Instagram'),
    facebook: cap('Facebook'), whatsapp: cap('WhatsApp'),
  },
  image_prompt: 'mock',
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addCookies([{ name: 'sp_session', value: token, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
await page.route('**/api/generate-content', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(MOCK),
}));

await page.goto('http://localhost:3001/content-studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const sf = page.getByRole('button', { name: /start fresh/i }).first();
if (await sf.count()) { await sf.click().catch(() => {}); await page.waitForTimeout(2000); }

await page.locator('textarea').first().fill('verifying the picker layout').catch(() => {});
await page.waitForTimeout(600);

const onStep2 = async () => (await page.getByText(/Creative Settings/i).count()) > 0;

for (let i = 0; i < 30; i++) {
  if (await page.getByText(/Send to:/i).count()) break;

  // Step 2 is gated behind an aspect ratio + >=1 selected platform.
  if (await onStep2()) {
    const ratio = page.getByRole('button', { name: /Standard/i }).first();
    if (await ratio.count()) { await ratio.click().catch(() => {}); await page.waitForTimeout(400); }
    for (const [re, name] of [[/LinkedIn/, 'LinkedIn'], [/WhatsApp/, 'WhatsApp']]) {
      const card = page.getByRole('button', { name: re }).first();
      if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(500); }
      else console.log(`  (platform card ${name} not found)`);
    }
  }

  // On step 7 the advance control is "Publish ->" (it just calls goNext() to
  // reveal step 8, the publish config). Safe: the loop bails on "Send to:".
  const candidates = [
    [page.getByRole('button', { name: /Generate Content/i }).first(), 'generate'],
    [page.getByRole('button', { name: /^Next/ }).first(), 'next'],
    [page.getByRole('button', { name: /^Publish\s*→$/ }).first(), 'advance-to-publish-config'],
  ];
  const ready = async (el) => (await el.count()) > 0 && !(await el.isDisabled().catch(() => true));
  let btn = null;
  for (const [el, name] of candidates) { if (await ready(el)) { btn = el; console.log(`  using ${name}`); break; } }
  if (!btn) { await page.waitForTimeout(1200); continue; }
  const label = (await btn.textContent().catch(() => '')) || '';
  await btn.click().catch(() => {});
  console.log(`clicked: ${label.trim().slice(0, 24)}`);
  await page.waitForTimeout(2500);
}
const reached = (await page.getByText(/Send to:/i).count()) > 0;
console.log('reached publish step:', reached);
if (!reached) { await page.screenshot({ path: '/tmp/picker-FAILED.png', fullPage: true }); await browser.close(); process.exit(1); }

const trigger = page.getByText(/Select chats, groups or communities/i).first();
await trigger.click().catch(() => {});
await page.waitForTimeout(1000);

const geo = await page.evaluate(() => {
  const search = [...document.querySelectorAll('input')].find((i) => /search chats/i.test(i.placeholder || ''));
  if (!search) return { error: 'panel not open' };
  const panel = search.closest('div[style*="fixed"]');
  if (!panel) return { error: 'panel is not position:fixed', pos: getComputedStyle(search.parentElement?.parentElement || search).position };
  const r = panel.getBoundingClientRect();
  // Is anything clipping the panel? Walk ancestors and look for overflow + containing blocks.
  const blockers = [];
  for (let a = panel.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflow !== 'visible' || s.overflowY !== 'visible' || s.overflowX !== 'visible') {
      const ar = a.getBoundingClientRect();
      blockers.push({ tag: a.tagName, overflow: s.overflow, clips: ar.bottom <= r.top + 1 || ar.top >= r.bottom - 1 || ar.right <= r.left + 1 || ar.left >= r.right - 1 });
    }
  }
  return {
    position: getComputedStyle(panel).position,
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    height: Math.round(r.height), width: Math.round(r.width),
    withinViewport: r.top >= 0 && r.bottom <= window.innerHeight,
    checkboxRows: panel.querySelectorAll('input[type=checkbox]').length,
    filters: [...panel.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 5),
    clippingAncestors: blockers,
  };
});
console.log('panel:', JSON.stringify(geo, null, 1));
await page.screenshot({ path: '/tmp/picker-open.png' });

// click the first destination and confirm it registers as selected
const first = page.getByText(/Bhagwat Katha|@Dadri/i).first();
if (await first.count()) {
  await first.click().catch(() => {});
  await page.waitForTimeout(800);
  console.log('selection registered:', await page.evaluate(() =>
    [...document.querySelectorAll('input[type=checkbox]')].some((i) => i.checked)));
  await page.screenshot({ path: '/tmp/picker-selected.png' });
}
await browser.close();
process.exit(0);
