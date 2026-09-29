// Captures the animation at each phase so it can be eyeballed, not assumed.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/sa-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:3001/superadmin/login?animationDebug=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.screenshot({ path: `${OUT}/1-credentials.png` });
console.log('1-credentials.png');

await page.locator('.test-anim').click();
await page.waitForTimeout(330);
await page.screenshot({ path: `${OUT}/2-door-open.png` });
console.log('2-door-open.png');

await page.waitForTimeout(330);
await page.screenshot({ path: `${OUT}/3-walking.png` });
console.log('3-walking.png');

await page.waitForTimeout(420);
await page.screenshot({ path: `${OUT}/4-mascot-happy.png` });
console.log('4-mascot-happy.png');

await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/5-settled.png` });
console.log('5-settled.png');

// error state
await page.fill('#email', 'dev.dotstark@gmail.com');
await page.fill('#password', 'wrong-password-here');
await page.locator('.btn').first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/6-error.png` });
console.log('6-error.png');

// mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/7-mobile.png` });
console.log('7-mobile.png');

await browser.close();
