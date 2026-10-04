// Screenshots each mascot state so it can be eyeballed.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/sa-states';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:3001/superadmin/login?animationDebug=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 210, y: 40, width: 480, height: 460 } });
  console.log(name);
};

await shot('1-neutral');

await page.locator('#sa-email').click();
await page.waitForTimeout(700);
await shot('2-email-focus');

await page.locator('#sa-password').click();
await page.waitForTimeout(800);
await shot('3-password-covered');

await page.locator('#sa-password').type('secret');
await page.locator('.sa-eye').click();
await page.waitForTimeout(800);
await shot('4-password-visible-peek');

await page.locator('.sa-debug__btn', { hasText: 'error' }).first().click();
await page.waitForTimeout(200);
await shot('5-error');

await page.locator('.sa-debug__btn', { hasText: 'success' }).first().click();
await page.waitForTimeout(250);
await shot('6-success');

await browser.close();
