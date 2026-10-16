const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require(path.join(__dirname, '../apps/web/node_modules/playwright'));

const BASE_URL = process.env.SOCIALPULSE_LOCAL_URL || 'http://127.0.0.1:3017';
const ARTIFACTS = path.join(__dirname, '../artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

async function verifyResponsiveChromium() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: { 'cf-ipcountry': 'IN' } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const widths = [320, 360, 375, 390, 393, 414, 430, 768, 1280, 1440];
  for (const width of widths) {
    const height = width <= 430 ? 720 : 900;
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE_URL}/login-signup?mode=signup`, { waitUntil: 'domcontentloaded' });
    const field = page.locator('[data-phone-country]').filter({ has: page.locator('#sp-mobile') });
    await field.scrollIntoViewIfNeeded();
    await field.getByRole('button', { name: /Choose country/ }).click();
    const box = await page.getByRole('listbox').locator('..').boundingBox();
    assert.ok(box, `dropdown missing at ${width}px`);
    assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `dropdown horizontally clipped at ${width}px`);
    assert.ok(box.y >= 0 && box.y + box.height <= height + 0.5, `dropdown vertically clipped at ${width}px`);
    if (width === 390) await page.screenshot({ path: path.join(ARTIFACTS, 'country-selector-mobile-390.png'), fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0, 'Escape should close the dropdown');
    console.log(`responsive: ${width}px passed`);
  }
  await context.close();

  const touchContext = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'cf-ipcountry': 'IN' } });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(`${BASE_URL}/login-signup?mode=signup`, { waitUntil: 'domcontentloaded' });
  const touchField = touchPage.locator('[data-phone-country]').filter({ has: touchPage.locator('#sp-mobile') });
  await touchField.getByRole('button', { name: /Choose country/ }).tap();
  await touchPage.getByRole('combobox').fill('Australia');
  await touchPage.getByRole('option', { name: /Australia AU \+61/ }).tap();
  assert.equal(await touchField.getAttribute('data-phone-country'), 'AU');
  await touchContext.close();
  await browser.close();
  console.log('responsive: 10 widths and Chromium touch passed');
}

async function verifyWebKitTouch() {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'cf-ipcountry': 'GB' } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${BASE_URL}/login-signup?mode=signup`, { waitUntil: 'domcontentloaded' });
  const field = page.locator('[data-phone-country]').filter({ has: page.locator('#sp-mobile') });
  assert.equal(await field.getAttribute('data-phone-country'), 'GB');
  await field.getByRole('button', { name: /Choose country/ }).tap();
  await page.getByRole('combobox').fill('India');
  await page.getByRole('option', { name: /India IN \+91/ }).tap();
  assert.equal(await field.getAttribute('data-phone-country'), 'IN');
  await browser.close();
  console.log('responsive: WebKit iOS-style touch passed');
}

(async () => {
  await verifyResponsiveChromium();
  await verifyWebKitTouch();
  console.log(JSON.stringify({
    ok: true,
    widths: [320, 360, 375, 390, 393, 414, 430, 768, 1280, 1440],
    browsers: ['Chromium Android-style touch', 'WebKit iOS-style touch'],
    screenshot: 'artifacts/country-selector-mobile-390.png',
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
