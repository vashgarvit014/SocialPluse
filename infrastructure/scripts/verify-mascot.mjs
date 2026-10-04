// Verifies the mascot reacts to real user input, not just that CSS exists.
// Run: node scripts/verify-mascot.mjs
import { chromium } from 'playwright';

const PAGE = 'http://localhost:3001/superadmin/login';
const results = [];
const ok = (n, pass, detail = '') => results.push({ n, pass, detail });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(PAGE, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const state = () => page.locator('.sa-mascot').getAttribute('data-state');
const pawL = () => page.locator('.sa-m-paw--left').evaluate(el => getComputedStyle(el).transform);
const eyeL = () => page.locator('.sa-m-eye--left').evaluate(el => getComputedStyle(el).transform);

// translation value out of a computed matrix3d/matrix; "none" means the part
// sits at its authored position, i.e. translateY 0.
function translateY(t) {
  if (!t || t === 'none') return 0;
  const m = t.match(/matrix(3d)?\(([^)]+)\)/);
  if (!m) return null;
  const v = m[2].split(',').map(Number);
  return m[1] ? v[13] : v[5];
}

// ---- 1. neutral on load ----
ok('neutral on load', (await state()) === 'neutral', await state());
const pawRestY = translateY(await pawL());
ok('paws rest low at neutral', pawRestY !== null && Math.abs(pawRestY) < 2, `translateY=${pawRestY}`);
const eyeNeutral = await eyeL();
ok('eyes relaxed at neutral', /0\.5/.test(eyeNeutral), eyeNeutral.slice(0, 40));

// ---- 2. email focus ----
await page.locator('#sa-email').click();
await page.waitForTimeout(600);
ok('emailFocus on email focus', (await state()) === 'emailFocus', await state());
const pawEmailY = translateY(await pawL());
ok('paws perk up on email focus', pawEmailY < pawRestY - 4, `rest=${pawRestY} focus=${pawEmailY}`);
const eyeEmail = await eyeL();
ok('eyes open on email focus', !/0\.5/.test(eyeEmail) && /1\.0/.test(eyeEmail), eyeEmail.slice(0, 40));

// ---- 3. password focus -> paws cover eyes ----
await page.locator('#sa-password').click();
await page.waitForTimeout(700);
ok('passwordHidden on password focus', (await state()) === 'passwordHidden', await state());
const pawCoverY = translateY(await pawL());
ok('paws RISE toward eyes', pawCoverY < pawEmailY - 30, `email=${pawEmailY} covered=${pawCoverY}`);
const eyeShut = await eyeL();
ok('eyes shut when covered', /0\.0[0-9]/.test(eyeShut), eyeShut.slice(0, 40));

// stays covered while typing
await page.locator('#sa-password').type('hunter2');
await page.waitForTimeout(250);
ok('stays covered while typing', (await state()) === 'passwordHidden', await state());

// ---- 4. reveal -> peek ----
await page.locator('.sa-eye').click();
await page.waitForTimeout(700);
ok('passwordVisible on reveal', (await state()) === 'passwordVisible', await state());
const pawPeekY = translateY(await pawL());
ok('paws LOWER to peek', pawPeekY > pawCoverY + 15, `covered=${pawCoverY} peek=${pawPeekY}`);
const eyePeek = await eyeL();
ok('eyes open when peeking', /1\.1/.test(eyePeek), eyePeek.slice(0, 40));

// hide again -> covers
await page.locator('.sa-eye').click();
await page.waitForTimeout(700);
ok('covers again on re-hide', (await state()) === 'passwordHidden', await state());
const pawRe = translateY(await pawL());
ok('paws return to cover', Math.abs(pawRe - pawCoverY) < 2, `${pawCoverY} vs ${pawRe}`);

// ---- 5. blur -> back to neutral, smoothly ----
await page.locator('#sa-email').focus();
await page.waitForTimeout(200);
ok('switches to emailFocus not neutral-on-blur', (await state()) === 'emailFocus', await state());
await page.locator('h1.sa-title').click();
await page.waitForTimeout(700);
ok('returns to neutral on blur', (await state()) === 'neutral', await state());
const pawBackY = translateY(await pawL());
ok('paws return to rest', Math.abs(pawBackY - pawRestY) < 2, `${pawRestY} vs ${pawBackY}`);

// ---- 6. error reaction, and NO door animation ----
await page.fill('#sa-email', 'dev.dotstark@gmail.com');
await page.fill('#sa-password', 'wrong-password-xyz');
await page.locator('.sa-btn').first().click();
await page.waitForTimeout(220);
const errState = await state();
ok('error mascot state on bad login', errState === 'error', errState);
const errAnim = await page.locator('.sa-mascot').evaluate(el => getComputedStyle(el).animationName);
ok('error uses shake not bounce', errAnim === 'saShake', errAnim);
const btnCls = await page.locator('.sa-btn').first().getAttribute('class');
ok('NO door animation on bad login', !/dooropen|walking/.test(btnCls || ''), btnCls);
const panelT = await page.locator('.sa-door__panel').evaluate(el => getComputedStyle(el).transform);
ok('door still closed on bad login', !panelT.includes('matrix3d'), panelT.slice(0, 30));
await page.waitForTimeout(1100);
ok('error state clears itself', (await state()) !== 'error', await state());

// ---- 7. debug switchboard ----
await page.goto(`${PAGE}?animationDebug=1`, { waitUntil: 'networkidle' });
const btnCount = await page.locator('.sa-debug__btn').count();
ok('debug controls present', btnCount === 6, `${btnCount} buttons`);
for (const s of ['neutral', 'emailFocus', 'passwordHidden', 'passwordVisible', 'error', 'success']) {
  await page.locator(`.sa-debug__btn`, { hasText: s }).first().click();
  await page.waitForTimeout(500);
  const got = await state();
  ok(`debug drives "${s}"`, got === s, got);
}
// and it must be absent without the flag
await page.goto(PAGE, { waitUntil: 'networkidle' });
ok('debug hidden without flag', (await page.locator('.sa-debug__btn').count()) === 0);

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.detail ? '  [' + r.detail + ']' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
