const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require(path.join(__dirname, '../apps/web/node_modules/playwright'));

const BASE_URL = process.env.SOCIALPULSE_LOCAL_URL || 'http://127.0.0.1:3017';
const ARTIFACTS = path.join(__dirname, '../artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

async function installAuthMocks(page, received) {
  await page.route('**/api/auth/login', async route => {
    received.login.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ purpose: 'LOGIN_VERIFY', channels: { email: 'pe***@example.com', whatsapp: '+91 ******3210' } }) });
  });
  await page.route('**/api/auth/signup', async route => {
    received.signup.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ purpose: 'SIGNUP_VERIFY', channels: { email: 'ne***@example.com', whatsapp: '+91 ******3210' } }) });
  });
  await page.route('**/api/auth/password/forgot', async route => {
    received.forgot.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'If an account exists for the provided details, a verification code has been sent.', challengeId: 'challenge-forgot', maskedDestination: '+91 ******3210', resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }) });
  });
  await page.route('**/api/auth/otp/request', async route => {
    received.otpRequest.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ challengeId: 'challenge-1', resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }) });
  });
  await page.route('**/api/auth/otp/verify', async route => {
    received.otpVerify.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ canResetPassword: true }) });
  });
}

async function chooseCountry(page, fieldId, search, expectedName) {
  const field = page.locator(`[data-phone-country]`).filter({ has: page.locator(`#${fieldId}`) });
  await field.getByRole('button', { name: /Choose country or territory/ }).click();
  const searchBox = page.getByRole('combobox', { name: 'Search country or dialing code' });
  await searchBox.fill(search);
  const option = page.getByRole('option', { name: new RegExp(expectedName, 'i') }).first();
  await option.click();
  return field;
}

async function runChromiumTests() {
  const browser = await chromium.launch({ headless: true });
  const received = { login: [], signup: [], forgot: [], otpRequest: [], otpVerify: [] };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { 'cf-ipcountry': 'US' },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await installAuthMocks(page, received);

  await page.goto(`${BASE_URL}/login-signup`, { waitUntil: 'networkidle' });
  console.log('browser: login page ready');
  await page.getByRole('radio', { name: 'Mobile' }).click();
  const loginPhoneField = page.locator('[data-phone-country]').filter({ has: page.locator('#sp-identifier') });
  assert.equal(await loginPhoneField.getAttribute('data-phone-country'), 'US', 'Cloudflare country header should preselect US');
  assert.match(await loginPhoneField.getByRole('button', { name: /Choose country/ }).innerText(), /\+1/);

  await loginPhoneField.getByRole('button', { name: /Choose country/ }).click();
  assert.equal(await page.getByRole('option').count(), 245, 'dropdown must contain every dataset country/territory');
  const dropdownBox = await page.getByRole('listbox').locator('..').boundingBox();
  assert.ok(dropdownBox && dropdownBox.x >= 0 && dropdownBox.x + dropdownBox.width <= 1440);
  await page.screenshot({ path: path.join(ARTIFACTS, 'country-selector-desktop.png'), fullPage: true });

  const search = page.getByRole('combobox', { name: 'Search country or dialing code' });
  await search.fill('IN');
  assert.ok(await page.getByRole('option', { name: /India IN \+91/ }).isVisible());
  await search.fill('+1');
  assert.ok((await page.getByRole('option').count()) > 10);
  await search.fill('India');
  await search.press('ArrowDown');
  await search.press('ArrowUp');
  await search.press('Enter');
  assert.equal(await loginPhoneField.getAttribute('data-phone-country'), 'IN');
  const countryTrigger = loginPhoneField.getByRole('button', { name: /Choose country/ });
  await countryTrigger.click();
  await page.getByText('Welcome to SocialPulse').click();
  assert.equal(await page.getByRole('listbox').count(), 0, 'clicking outside should close the dropdown');
  await countryTrigger.click();
  await page.getByRole('combobox').press('Escape');
  assert.equal(await countryTrigger.evaluate(element => element === document.activeElement), true, 'Escape should restore trigger focus');

  await page.locator('#sp-identifier').fill('9876543210');
  await page.getByRole('radio', { name: 'Email' }).click();
  await page.getByRole('radio', { name: 'Mobile' }).click();
  assert.equal(await loginPhoneField.getAttribute('data-phone-country'), 'IN', 'manual selection must survive mode switches');

  await page.locator('#sp-identifier').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '+971 50 123 4567');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }));
  });
  assert.equal(await loginPhoneField.getAttribute('data-phone-country'), 'AE', 'international paste should update country');
  await page.locator('#sp-password').fill('SocialPulse9!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Verify your identity' }).waitFor();
  assert.equal(received.login[0].identifier, '+971501234567');
  console.log('browser: mobile login payload verified');

  await page.goto(`${BASE_URL}/login-signup?mode=signup`, { waitUntil: 'networkidle' });
  console.log('browser: signup page ready');
  await page.locator('#sp-name').fill('New User');
  await page.locator('#sp-email').fill('new.user@example.com');
  await chooseCountry(page, 'sp-mobile', 'India', 'India');
  console.log('browser: signup country selected');
  await page.locator('#sp-mobile').fill('9876543210');
  await page.locator('#sp-password').fill('SocialPulse9!');
  await page.locator('#sp-confirm-password').fill('SocialPulse9!');
  console.log('browser: signup fields filled');
  await page.getByRole('button', { name: 'Continue' }).click();
  console.log('browser: signup submitted');
  await page.getByRole('heading', { name: 'Verify your identity' }).waitFor();
  assert.equal(received.signup[0].mobile, '+919876543210');
  assert.equal(received.signup[0].email, 'new.user@example.com');
  await page.getByRole('button', { name: /^Email/ }).click();
  console.log('browser: OTP requested');
  await page.getByRole('heading', { name: 'Enter Verification Code' }).waitFor();
  assert.deepEqual(received.otpRequest[0], { channel: 'EMAIL' });
  const otpInputs = page.locator('input[inputmode="numeric"]');
  for (let index = 0; index < 6; index += 1) await otpInputs.nth(index).fill(String(index + 1));
  console.log('browser: OTP entered');
  await page.getByRole('heading', { name: 'Set a new password' }).waitFor();
  assert.deepEqual(received.otpVerify[0], { challengeId: 'challenge-1', otp: '123456' });
  console.log('browser: signup and OTP flow verified');

  await page.goto(`${BASE_URL}/login-signup`, { waitUntil: 'networkidle' });
  await page.locator('#sp-identifier').fill('person@example.com');
  await page.locator('#sp-password').fill('SocialPulse9!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Verify your identity' }).waitFor();
  assert.equal(received.login.at(-1).identifier, 'person@example.com', 'email login payload must remain unchanged');
  console.log('browser: email login verified');

  await page.goto(`${BASE_URL}/login-signup`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Forgot Password?' }).click();
  await page.getByRole('radio', { name: 'Mobile' }).click();
  await chooseCountry(page, 'sp-forgot', 'India', 'India');
  await page.locator('#sp-forgot').fill('9876543210');
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.getByRole('heading', { name: 'Enter Verification Code' }).waitFor();
  assert.equal(received.forgot[0].identifier, '+919876543210');
  console.log('browser: recovery flow verified');

  await context.close();
  await browser.close();
  return received;
}

(async () => {
  const received = await runChromiumTests();
  console.log(JSON.stringify({
    ok: true,
    supportedEntries: 245,
    authRequests: Object.fromEntries(Object.entries(received).map(([key, values]) => [key, values.length])),
    screenshots: ['artifacts/country-selector-desktop.png'],
    browsers: ['Chromium desktop'],
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
