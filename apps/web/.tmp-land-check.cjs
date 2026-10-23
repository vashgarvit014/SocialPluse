const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  for (const w of [375, 390, 393, 414, 430]) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    await page.goto('http://localhost:3001/local-preview?step=8', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bodyScrollW: document.body.scrollWidth,
    }));
    console.log(`${w}px: scrollWidth=${metrics.scrollW} clientWidth=${metrics.clientW} ${metrics.scrollW === metrics.clientW ? 'OK' : 'OVERFLOW'}`);
    const bar = page.locator('nav.sp-cr');
    if (await bar.count()) {
      await bar.screenshot({ path: `/tmp/mob/stepper-${w}.png` });
      const box = await bar.boundingBox();
      const ring = page.locator('.sp-cr-ring');
      const rbox = await ring.boundingBox();
      console.log(`  bar x=${box.x.toFixed(1)} w=${box.width.toFixed(1)} | ring x=${rbox.x.toFixed(1)} w=${rbox.width.toFixed(1)} ${rbox.x < box.x ? 'RING-OUTSIDE-LEFT' : 'ring-inside'}`);
    } else {
      console.log('  no nav.sp-cr found');
    }
    await page.screenshot({ path: `/tmp/mob/page-${w}.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
