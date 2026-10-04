// Local-only visual/behavioral check for the Superadmin login animation.
// Not part of the app; run with: node scripts/verify-login-animation.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const PAGE = `${BASE}/superadmin/login`;
const results = [];
const ok = (n, pass, detail = '') => results.push({ n, pass, detail });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${PAGE}?animationDebug=1`, { waitUntil: 'networkidle' });

// ---- visual / layout ----
const card = page.locator('.sa-card').first();
const box = await card.boundingBox();
ok('card renders', !!box, JSON.stringify(box));
ok('card width 520-580', box && box.width >= 520 && box.width <= 580, `w=${box?.width}`);

const titleTxt = (await page.locator('.sa-title').innerText()).trim();
ok('title is SocialPulse', titleTxt === 'SocialPulse', titleTxt);
const subTxt = (await page.locator('.sa-sub').innerText()).trim();
ok('subtitle has no third-party text', !/den|husky/i.test(subTxt), subTxt);

const mascotBox = await page.locator('.sa-mascot').boundingBox();
ok('mascot 170-190', mascotBox && mascotBox.width >= 165 && mascotBox.width <= 195, JSON.stringify(mascotBox));
// paws must straddle the card's top edge
const pawBottom = mascotBox.y + mascotBox.height;
ok('mascot overlaps card top edge', pawBottom > box.y, `paws end ${Math.round(pawBottom)} vs card top ${Math.round(box.y)}`);

const inputBg = await page.locator('#sa-email').evaluate(el => getComputedStyle(el).backgroundColor);
ok('input dark not white', !/rgb\(255, 255, 255\)/.test(inputBg), inputBg);
const inputColor = await page.locator('#sa-email').evaluate(el => getComputedStyle(el).color);
ok('input text near-white', /2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}/.test(inputColor), inputColor);

await page.locator('#sa-email').focus();
await page.waitForTimeout(350); // box-shadow/glow transition is .22s
const glow = await page.locator('#sa-email').evaluate(el => getComputedStyle(el).boxShadow);
ok('focus glow present', glow && glow !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(glow), glow.slice(0, 50));

// eye toggle
ok('password starts hidden', (await page.locator('#sa-password').getAttribute('type')) === 'password');
await page.locator('.sa-eye').click();
ok('eye reveals password', (await page.locator('#sa-password').getAttribute('type')) === 'text');
await page.locator('.sa-eye').click();
ok('eye re-hides password', (await page.locator('#sa-password').getAttribute('type')) === 'password');

// no fake controls
ok('no remember-me checkbox', (await page.locator('input[type=checkbox]').count()) === 0);
ok('no dead href="#"', (await page.locator('a[href="#"]').count()) === 0);
ok('no normal-user login link', (await page.getByText('Normal user login').count()) === 0);
ok('no social login buttons', (await page.getByText(/google|apple|create account/i).count()) === 0);

// ---- the animation itself ----
const panelBefore = await page.locator('.sa-door__panel').evaluate(el => getComputedStyle(el).transform);

await page.locator('.sa-test').click();
await page.waitForTimeout(120);

const clsOpen = await page.locator('.sa-btn').first().getAttribute('class');
ok('dooropen class applied', /dooropen/.test(clsOpen || ''), clsOpen);

const panelOpen = await page.locator('.sa-door__panel').evaluate(el => getComputedStyle(el).transform);
ok('door rotates (3D matrix)', panelOpen.includes('matrix3d') && panelOpen !== panelBefore, `${panelBefore} -> ${panelOpen.slice(0, 30)}`);

const personOpacity = await page.locator('.sa-person').evaluate(el => getComputedStyle(el).opacity);
ok('person visible after dooropen', Number(personOpacity) > 0.5, `opacity=${personOpacity}`);

await page.waitForTimeout(420);
const clsWalk = await page.locator('.sa-btn').first().getAttribute('class');
ok('walking class applied', /walking/.test(clsWalk || ''), clsWalk);
const legAnim = await page.locator('.sa-person__legs').evaluate(el => getComputedStyle(el, '::before').animationName);
ok('legs animating', legAnim === 'saLeg1', legAnim);

await page.waitForTimeout(150);
const midTransform = await page.locator('.sa-person').evaluate(el => getComputedStyle(el).transform);
ok('person walking across', /matrix\(1, 0, 0, 1, [1-9]/.test(midTransform), midTransform.slice(0, 40));

// happy begins at DOOR_MS + WALK_MS (380 + 680 = 1060ms) after the click
await page.waitForTimeout(420);
const mascotState = await page.locator('.sa-mascot').getAttribute('data-state');
ok('mascot success state', mascotState === 'success', mascotState);
const mascotAnim = await page.locator('.sa-mascot').evaluate(el => getComputedStyle(el).animationName);
ok('mascot bounce keyframes', mascotAnim === 'saBounce', mascotAnim);

await page.waitForTimeout(900);
ok('mascot settles', (await page.locator('.sa-mascot').getAttribute('data-state')) !== 'success');
const panelAfter = await page.locator('.sa-door__panel').evaluate(el => getComputedStyle(el).transform);
ok('door resets closed', panelAfter === panelBefore, panelAfter.slice(0, 30));

// ---- invalid credentials must NOT animate ----
const errorsBeforeBadLogin = errors.length;
await page.goto(PAGE, { waitUntil: 'networkidle' });
await page.fill('#sa-email', 'dev.dotstark@gmail.com');
await page.fill('#sa-password', 'definitely-wrong-password');
await page.locator('.sa-btn').first().click();

let sawAnimation = false;
for (let i = 0; i < 24; i++) {
  const c = await page.locator('.sa-btn').first().getAttribute('class');
  if (/dooropen|walking/.test(c || '')) { sawAnimation = true; break; }
  await page.waitForTimeout(50);
}
ok('NO animation on bad credentials', !sawAnimation, sawAnimation ? 'animated!' : 'stayed idle');
const errTxt = (await page.locator('.sa-error').innerText()).trim();
ok('error shown on bad credentials', errTxt.length > 0, errTxt);
ok('still on login page after failure', page.url().includes('/superadmin/login'), page.url());

ok('no console/page errors (pre-submit)', errorsBeforeBadLogin === 0, errors.slice(0, 2).join(' | '));

// ---- responsive: no horizontal overflow at any width ----
for (const w of [1920, 1440, 1280, 768, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`no h-overflow @${w}`, overflow <= 1, `overflow=${overflow}px`);
  const cw = (await page.locator('.sa-card').first().boundingBox()).width;
  ok(`card fits @${w}`, cw <= w, `card=${Math.round(cw)} viewport=${w}`);
}

// ---- reduced motion: only when the OS asks ----
const rm = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
const rmPage = await rm.newPage();
await rmPage.goto(`${PAGE}?animationDebug=1`, { waitUntil: 'networkidle' });
await rmPage.locator('.sa-test').click();
await rmPage.waitForTimeout(200);
ok('reduced-motion: no mascot bounce', (await rmPage.locator('.sa-mascot').evaluate(el => getComputedStyle(el).animationName)) === 'none');ok('reduced-motion: no leg cycling', (await rmPage.locator('.sa-person__legs').evaluate(el => getComputedStyle(el, '::before').animationName)) === 'none');
ok('reduced-motion: door still opens', (await rmPage.locator('.sa-door__panel').evaluate(el => getComputedStyle(el).transform)).includes('matrix3d'));
await rm.close();

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.detail ? '  [' + r.detail + ']' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
