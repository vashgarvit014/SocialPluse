// Isolated Chrome profile, local fixture APIs, no external provider traffic.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext();
    let posts = []; const connected = new Set();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname.startsWith('/api/connect/')) {
        const provider = url.pathname.split('/').pop();
        connected.add(provider);
        const params = new URLSearchParams({ editor_return: url.searchParams.get('return_id'), provider });
        if (provider === 'whatsapp') params.set('error', 'OAuth is not configured');
        return route.fulfill({ status: 302, headers: { location: '/oauth-return?' + params.toString() } });
      }
      if (url.pathname.endsWith('/status')) return route.fulfill({ json: { connected: connected.has(url.pathname.split('/')[2]), userId: 'test-user', displayName: 'Test Canva' } });
      if (url.pathname === '/api/media/alt') return route.fulfill({ json: { altText: 'A small red square.' } });
      if (url.pathname === '/api/scheduler') {
        const body = route.request().postDataJSON();
        if (route.request().method() === 'DELETE') {
          posts = body.action === 'delete-draft' ? posts.filter(p => p.id !== body.id) : posts.map(p => p.id === body.id ? { ...p, status: 'draft', scheduledAt: null, cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'Schedule Cancelled' } : p);
          return route.fulfill({ json: { success: true } });
        }
        if (route.request().method() === 'POST') { const post = { ...body, id: body.id || 'test-draft', status: body.status || 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; posts = [post]; return route.fulfill({ json: { post, success: true } }); }
        return route.fulfill({ json: { posts } });
      }
      return route.fulfill({ status: 400, json: { error: 'No test API fixture' } });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
    await page.goto('http://localhost:3001');
    const snapshot = {
      prompt: 'Accessibility test', content: 'Preserved caption', tone: 'Professional', imageStyle: 'Photographic', aspectRatio: '1:1',
      mediaItems: [
        { id: 'b', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', type: 'image', name: 'canva-edit', altText: 'Existing B description' },
        { id: 'a', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', type: 'image', name: 'generated', altText: 'Existing A description' },
      ], topicMediaItems: [], selectedPlatforms: ['instagram', 'facebook'], isCarousel: true, carouselSlideIds: ['b', 'a'], carouselSlideCount: 2,
      wizardState: { currentStep: 4, selectedMediaId: 'b', headingFont: 'Poppins', bodyFont: 'Inter', brandSwatches: ['#abcdef'] },
      logoImage: '', logoPosition: 'bottom-right', logoScale: .18, logoOpacity: 1, burnedLogoIds: { b: true }, originals: { b: 'original-bytes' },
      activeTab: 'studio', editorTab: 'preview', draftId: undefined, scheduleDate: '2026-10-18', scheduleTime: '10:30',
      platformContent: { instagram: { caption: 'Instagram caption', hashtags: ['one'] } }, savedAt: Date.now(), path: '/',
    };
    const id = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    await page.evaluate(async ({ id, snapshot }) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('socialpulse-editor', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('returns');
        request.onsuccess = () => { const db = request.result; const tx = db.transaction('returns', 'readwrite'); tx.objectStore('returns').put(snapshot, id); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; };
      });
    }, { id, snapshot });
    await page.goto('http://localhost:3001/?editor_return=' + id);
    await page.getByRole('heading', { name: /Accessibility/ }).waitFor();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('socialpulse-draft') || '{}').wizardState?.currentStep === 4);
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('socialpulse-draft')));
    let restored = await read();
    for (const key of ['content', 'mediaItems', 'carouselSlideIds', 'wizardState', 'burnedLogoIds', 'originals', 'scheduleDate', 'scheduleTime', 'platformContent']) assert.deepEqual(restored[key], snapshot[key]);
    console.log('PASS redirect: step, selected media, carousel order, ALT, branding, caption, schedule');
    // Real UI click opens the new popup flow. Server/provider hop is mocked;
    // actual return page postMessage and parent status handling run normally.
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Connect Canva →' }).click();
    const popup = await popupPromise; await popup.waitForEvent('close');
    await page.getByText(/Your editor is unchanged/).waitFor();
    restored = await read(); assert.equal(restored.wizardState.currentStep, 4); assert.deepEqual(restored.mediaItems, snapshot.mediaItems);
    console.log('PASS Canva popup closes; editor survives');
    await page.getByText('Slide 1 · ✓ Added · Edit ALT Text', { exact: true }).click();
    const alt = page.getByRole('textbox', { name: 'ALT text for slide 1' });
    await alt.fill('Edited accessible description');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('socialpulse-draft') || '{}').mediaItems?.[0]?.altText === 'Edited accessible description');
    await page.getByRole('button', { name: 'Clear', exact: true }).last().click();
    await page.getByRole('button', { name: 'Generate Missing ALT Text', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('socialpulse-draft') || '{}').mediaItems?.[0]?.altText === 'A small red square.');
    console.log('PASS ALT edit, clear, missing-generation UI');
    await page.getByRole('button', { name: /Save Draft/ }).first().click();
    await page.getByText('Draft saved.', { exact: true }).waitFor();
    assert.equal(posts[0].mediaList[0].altText, 'A small red square.');
    assert.deepEqual(posts[0].editorState.wizardState.brandSwatches, ['#abcdef']);
    console.log('PASS full draft saved with ALT and brand state');
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to Publish →', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('socialpulse-draft') || '{}').wizardState?.currentStep === 6);
    for (const provider of ['Linkedin', 'Facebook', 'Instagram']) {
      const before = await read();
      const opened = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'Connect ' + provider, exact: true }).click();
      const popup = await opened; await popup.waitForEvent('close');
      await page.getByText(new RegExp(provider.toLowerCase() + ' connected\\. OAuth')).waitFor();
      const after = await read();
      for (const key of ['content', 'mediaItems', 'carouselSlideIds', 'wizardState', 'burnedLogoIds', 'originals', 'scheduleDate', 'scheduleTime', 'platformContent']) assert.deepEqual(after[key], before[key]);
      console.log('PASS ' + provider + ' popup preserves step 6 and complete editor state');
    }
    posts = [{ ...posts[0], id: 'cancel-me', status: 'pending', scheduledAt: new Date(Date.now() + 600000).toISOString() }, { ...posts[0], id: 'older', status: 'draft', updatedAt: '2025-01-01T00:00:00Z' }];
    const beforeCancel = structuredClone(posts[0]);
    await page.reload(); await page.getByRole('button', { name: 'Keep my content →' }).click();
    await page.getByRole('button', { name: /Scheduler/ }).first().click();
    await page.getByRole('button', { name: 'Cancel Schedule', exact: true }).waitFor();
    page.once('dialog', async dialog => { assert.equal(dialog.message(), 'Cancel this scheduled post?'); await dialog.accept(); });
    await page.getByRole('button', { name: 'Cancel Schedule', exact: true }).click();
    await page.getByText('Schedule cancelled. Post moved to Drafts.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View Draft', exact: true }).click();
    assert.match(await page.locator('article').first().innerText(), /Schedule Cancelled/);
    assert.equal(posts[0].scheduledAt, null); assert.deepEqual(posts[0].mediaList, beforeCancel.mediaList);
    console.log('PASS cancel confirmation, toast, View Draft, ordering and content preservation');
    await page.locator('article').first().getByRole('button', { name: 'Schedule Again' }).click();
    await page.getByText('Schedule Post', { exact: true }).first().waitFor();
    console.log('PASS Schedule Again opens scheduling with retained content');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/socialpulse-editor-qa.png', fullPage: true });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
