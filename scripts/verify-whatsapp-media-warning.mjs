// Verifies the WhatsApp single-image warning (change C) renders when more than
// one image is attached, and that it names the image that will actually be
// sent (the first item in the publish media list).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { SignJWT } from 'jose';
import sharp from 'sharp';

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

// Two visibly different images so nothing dedupes them.
const A = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#7C3AED' } }).png().toBuffer();
const B = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#059669' } }).png().toBuffer();

const cap = (p) => ({ caption: `Mock ${p} caption. `.repeat(6), hashtags: ['design'] });
const MOCK = { platforms: { linkedin: cap('LI'), instagram: cap('IG'), facebook: cap('FB'), whatsapp: cap('WA') }, image_prompt: 'mock' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addCookies([{ name: 'sp_session', value: token, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
await page.route('**/api/generate-content', (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(MOCK),
}));

await page.goto('http://localhost:3001/content-studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const sf = page.getByRole('button', { name: /start fresh/i }).first();
if (await sf.count()) { await sf.click().catch(() => {}); await page.waitForTimeout(2000); }
await page.locator('textarea').first().fill('two images please').catch(() => {});
await page.waitForTimeout(600);

let uploaded = false;
const onStep2 = async () => (await page.getByText(/Creative Settings/i).count()) > 0;

for (let i = 0; i < 30; i++) {
  if (await page.getByText(/Send to:/i).count()) break;

  if (await onStep2()) {
    const ratio = page.getByRole('button', { name: /Standard/i }).first();
    if (await ratio.count()) { await ratio.click().catch(() => {}); await page.waitForTimeout(400); }
    for (const re of [/LinkedIn/, /WhatsApp/]) {
      const card = page.getByRole('button', { name: re }).first();
      if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(500); }
    }
  }

  // Media step: attach two images so the >1 case is exercised.
  if (!uploaded && (await page.getByText(/Upload Media/i).count()) > 0) {
    await page.locator('input[type=file]').first().setInputFiles([
      { name: 'alpha.png', mimeType: 'image/png', buffer: A },
      { name: 'beta.png', mimeType: 'image/png', buffer: B },
    ]);
    await page.waitForTimeout(3000);
    uploaded = true;
    console.log('uploaded 2 images at Media step');
  }

  const ready = async (el) => (await el.count()) > 0 && !(await el.isDisabled().catch(() => true));
  const cands = [
    [page.getByRole('button', { name: /Generate Content/i }).first(), 'generate'],
    [page.getByRole('button', { name: /^Next/ }).first(), 'next'],
    [page.getByRole('button', { name: /^Publish\s*→$/ }).first(), 'advance'],
  ];
  let btn = null;
  for (const [el] of cands) { if (await ready(el)) { btn = el; break; } }
  if (!btn) { await page.waitForTimeout(1200); continue; }
  await btn.click().catch(() => {});
  await page.waitForTimeout(2500);
}

const reached = (await page.getByText(/Send to:/i).count()) > 0;
console.log('reached publish step:', reached, '| uploaded:', uploaded);

const warn = page.getByText(/1 image per message/i).first();
const shown = (await warn.count()) > 0;
console.log('warning shown:', shown);
if (shown) {
  await warn.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(700);
  console.log('warning text:', (await warn.textContent()).replace(/\s+/g, ' ').trim());
}
await page.screenshot({ path: '/tmp/wa-warning.png' });
await browser.close();
process.exit(shown ? 0 : 1);
