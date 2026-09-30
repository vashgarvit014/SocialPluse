// Drives the studio wizard to the Publish step and exercises the new picker.
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
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m')
  .sign(new TextEncoder().encode(env.SESSION_SECRET));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
await ctx.addCookies([{ name: 'sp_session', value: token, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();
// The destinations endpoint paginates hundreds of chats + community subgroup
// lookups, so the network never goes idle — wait on DOM + explicit selectors.
page.setDefaultTimeout(60000);

page.on('console', (m) => { if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 120)); });

await page.goto('http://localhost:3001/content-studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// Step 1 -> give it a topic so Next unlocks
const ta = page.locator('textarea').first();
await ta.fill('Testing multi-destination WhatsApp publishing');
await page.waitForTimeout(600);

// Advance with the "Next ->" control until the Publish step renders.
for (let i = 0; i < 10; i++) {
  if (await page.getByText(/Send to:/i).count()) break;
  const next = page.getByRole('button', { name: /^Next/ }).first();
  if (!(await next.count())) break;
  const disabled = await next.isDisabled().catch(() => true);
  if (disabled) { console.log(`  stuck at step ${i + 1} (Next disabled)`); break; }
  await next.click().catch(() => {});
  await page.waitForTimeout(900);
}
await page.waitForTimeout(1500);

const hasPicker = await page.getByText(/Send to:/i).count();
console.log('picker visible:', hasPicker > 0);

if (hasPicker) {
  await page.getByText(/Select chats, groups or communities/i).first().click().catch(() => {});
  await page.waitForTimeout(1200);

  const dump = await page.evaluate(() => {
    const filters = [...document.querySelectorAll('button')]
      .map((b) => b.textContent?.trim())
      .filter((t) => t && /^(All|Communities|Groups|Chats) /.test(t));
    const boxes = document.querySelectorAll('input[type=checkbox]');
    return {
      filters,
      visibleCheckboxes: boxes.length,
      sections: [...document.querySelectorAll('span')]
        .map((s) => s.textContent?.trim())
        .filter((t) => t && /^(Community|Group|Chat) \(\d+\)$/.test(t)),
    };
  });
  console.log('filters:', JSON.stringify(dump.filters));
  console.log('sections:', JSON.stringify(dump.sections));
  console.log('checkboxes rendered:', dump.visibleCheckboxes);

  // select 2 across two types
  const boxes = page.locator('input[type=checkbox]');
  if (await boxes.count() >= 3) { await boxes.nth(0).check(); await boxes.nth(1).check(); }
  await page.waitForTimeout(600);
  const summary = await page.getByText(/destination[s]? selected/i).first().textContent().catch(() => null);
  console.log('status line:', (summary || '').trim());
  const btn = await page.getByRole('button', { name: /Publish to \d+ WhatsApp/i }).first().textContent().catch(() => null);
  console.log('publish button:', (btn || '').trim());
}
await page.screenshot({ path: '/tmp/whatsapp-multi.png' });
await browser.close();
