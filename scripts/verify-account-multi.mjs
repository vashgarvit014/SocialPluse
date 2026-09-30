// Renders the per-account multi-select with seeded (fake) connected accounts.
// Fake ids are localStorage-only, so nothing is published for real.
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

const SEED = [
  { platform: 'linkedin', connected: true, name: 'Dev - Personal', email: 'dev.one@gmail.com', userId: 'fake-li-001' },
  { platform: 'linkedin', connected: true, name: 'Dev - Work', email: 'dev@company.com', userId: 'fake-li-002' },
  { platform: 'linkedin', connected: true, name: 'Dev - Third', email: 'dev3@company.com', userId: 'fake-li-003' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1250 } });
await ctx.addCookies([{ name: 'sp_session', value: token, domain: 'localhost', path: '/' }]);
await ctx.addInitScript((seed) => {
  localStorage.setItem('socialAccounts', JSON.stringify(seed));
}, SEED);

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });

// The client collapses LinkedIn/FB/IG to ONE account from the server vault
// (social-media-manager.tsx: prev.filter(a => a.platform !== 'linkedin')),
// and localStorage seeding is stripped on load. So mock the status routes to
// prove the new per-account UI renders. Purely a render test — no publish runs.
await page.route('**/api/linkedin/status*', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ connected: true, userId: 'mock-li-001', name: 'Dev - Personal', email: 'dev.one@gmail.com' }),
  }));

await page.goto('http://localhost:3001/content-studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// A leftover draft from earlier runs raises a "Restore previous work?" modal,
// which blocks every click underneath. Dismiss it first.
const startFresh = page.getByRole('button', { name: /start fresh/i }).first();
if (await startFresh.count()) {
  await startFresh.click().catch(() => {});
  console.log('dismissed restore-prompt modal');
  await page.waitForTimeout(2500);
  // Re-seed: the draft reset can clear storage.
  await page.evaluate((seed) => {
    localStorage.setItem('socialAccounts', JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const sf2 = page.getByRole('button', { name: /start fresh/i }).first();
  if (await sf2.count()) { await sf2.click().catch(() => {}); await page.waitForTimeout(2000); }
}

const stored = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('socialAccounts') || '[]').length; } catch { return 'err'; }
});
console.log('accounts after load:', stored);

// The platform cards live on wizard step 2 (Settings). Advance with Next.
await page.locator('textarea').first().fill('Verifying per-account selection').catch(() => {});
await page.waitForTimeout(800);
const next = page.getByRole('button', { name: /^Next/ }).first();
if (await next.count()) { await next.click().catch(() => {}); await page.waitForTimeout(2500); }
console.log('on step 2:', (await page.getByText(/Post to \d+\/\d+ account|Post to \d+\/\d+ accounts/i).count()) > 0 || (await page.getByRole('button', { name: /LinkedIn/ }).count()) > 0);

const li = page.getByRole('button', { name: /LinkedIn/ }).first();
console.log('LinkedIn card found:', await li.count());
if (await li.count()) { await li.click().catch(() => {}); await page.waitForTimeout(2000); }

const bodyText = await page.evaluate(() => document.body.innerText);
console.log('mentions "Post to":', bodyText.includes('Post to'));
console.log('mentions "account":', /Post to \d/.test(bodyText));
const nearLi = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => /LinkedIn/.test(b.textContent || ''));
  return el ? el.parentElement?.parentElement?.innerText?.slice(0, 260) : 'card-not-found';
});
console.log('near card:', JSON.stringify(nearLi));

const counter = page.getByText(/Post to \d+\/\d+ account/i).first();
const hasPanel = await counter.count();
console.log('account panel visible:', hasPanel > 0);
if (hasPanel) {
  console.log('counter (auto-selected on platform toggle):', (await counter.innerText()).trim());
  const rows = await page.locator('label:has(input[type=checkbox])').allInnerTexts();
  console.log('account rows:', JSON.stringify(rows.map((s) => s.trim().replace(/\s+/g, ' '))));

  // uncheck the second account
  const cbs = page.locator('label:has(input[type=checkbox]) input');
  const n = await cbs.count();
  console.log('checkboxes:', n);
  if (n >= 2) { await cbs.nth(1).uncheck().catch(() => {}); await page.waitForTimeout(800); }
  console.log('counter after unchecking one:', (await counter.innerText()).trim());
}
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await page.screenshot({ path: '/tmp/accounts.png' });
await browser.close();
process.exit(0);
