const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(__dirname, '../apps/web/node_modules/playwright'));

const BASE_URL = process.env.SOCIALPULSE_SUPERADMIN_LOCAL_URL || 'http://localhost:3018';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'cf-ipcountry': 'GB' } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const loginBodies = [];
  const forgotBodies = [];
  await page.route('**/api/superadmin/auth/login', async route => {
    loginBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture complete.' }) });
  });
  await page.route('**/api/auth/password/forgot', async route => {
    forgotBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Fixture complete.', challengeId: 'fixture', resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }) });
  });

  await page.goto(`${BASE_URL}/superadmin/login`, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: 'Mobile' }).click();
  const field = page.locator('[data-phone-country]').filter({ has: page.locator('#sa-email') });
  assert.equal(await field.getAttribute('data-phone-country'), 'GB');
  await field.getByRole('button', { name: /Choose country/ }).click();
  assert.equal(await page.getByRole('option').count(), 245);
  await page.getByRole('combobox').fill('India');
  await page.getByRole('option', { name: /India IN \+91/ }).click();
  await page.locator('#sa-email').fill('9876543210');
  await page.locator('#sa-password').fill('SocialPulse9!');
  await Promise.all([
    page.waitForRequest('**/api/superadmin/auth/login'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  assert.equal(loginBodies[0].identifier, '+919876543210');

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('radio', { name: 'Mobile' }).click();
  const forgotField = page.locator('[data-phone-country]').filter({ has: page.locator('#sa-forgot') });
  await forgotField.getByRole('button', { name: /Choose country/ }).click();
  await page.getByRole('combobox').fill('United States');
  await page.getByRole('option', { name: /United States US \+1/ }).click();
  await page.locator('#sa-forgot').fill('4155552671');
  await Promise.all([
    page.waitForRequest('**/api/auth/password/forgot'),
    page.getByRole('button', { name: 'Send Reset Code' }).click(),
  ]);
  assert.equal(forgotBodies[0].identifier, '+14155552671');

  await browser.close();
  console.log(JSON.stringify({ ok: true, entries: 245, login: loginBodies[0].identifier, recovery: forgotBodies[0].identifier }, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
