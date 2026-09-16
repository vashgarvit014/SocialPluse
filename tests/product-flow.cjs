// Run with node --test tests/product-flow.cjs. No provider calls or real posts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } });
  module._compile(source.outputText, file);
};
const { NextRequest, NextResponse } = require('next/server');
const { cancelPost, newestDrafts } = require('../src/lib/posts.ts');
const { altPayload } = require('../src/lib/alt-capabilities.ts');
const sample = { id: 'one', content: 'First line\nFull caption', imageUrl: 'image', status: 'pending', scheduledAt: '2026-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z', platforms: ['instagram'], accounts: [{ platform: 'instagram', userId: 'test' }], mediaList: [{ id: 'b', type: 'image', url: 'b', altText: 'B', name: 'canva-edit' }, { id: 'a', type: 'image', url: 'a', altText: 'A', name: 'generated' }], isCarousel: true, platformContent: { instagram: { caption: 'Instagram caption', hashtags: ['test'] } }, branding: { logo: 'data', colors: ['purple'] }, editorState: { wizardState: { currentStep: 4, selectedMediaId: 'b' }, originals: { a: 'original' } } };

test('cancel keeps all content, clears schedule and sorts draft first', () => {
  const cancelled = cancelPost(sample, '2026-09-14T12:00:00Z');
  assert.equal(cancelled.status, 'draft'); assert.equal(cancelled.scheduledAt, null);
  for (const key of ['content', 'mediaList', 'isCarousel', 'platformContent', 'branding', 'editorState', 'platforms']) assert.deepEqual(cancelled[key], sample[key]);
  assert.equal(cancelled.updatedAt, cancelled.cancelledAt);
  assert.equal(newestDrafts([{ ...sample, id: 'old', status: 'draft' }, cancelled])[0].id, 'one');
  assert.throws(() => cancelPost({ ...sample, status: 'publishing' }));
});
test('ALT capability only maps verified image endpoints', () => {
  assert.deepEqual(altPayload('facebook', 'image', 'visible photo'), { alt_text_custom: 'visible photo' });
  assert.deepEqual(altPayload('instagram', 'image', 'visible photo'), { alt_text: 'visible photo' });
  for (const platform of ['linkedin', 'whatsapp', 'canva', 'future']) assert.deepEqual(altPayload(platform, 'image', 'text'), {});
  for (const platform of ['facebook', 'instagram', 'linkedin', 'whatsapp']) assert.deepEqual(altPayload(platform, 'video', 'text'), {});
  assert.deepEqual(altPayload('instagram', 'image', ''), {});
});
test('storage routes preserve snapshots, reschedule same ID, protect corrupt data and concurrent cancellation', async () => {
  const cwd = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'socialpulse-test-')); process.chdir(temp);
  const originalFetch = global.fetch;
  try {
    const api = require('../src/app/api/scheduler/route.ts');
    const store = require('../src/lib/post-store.ts');
    const check = require('../src/app/api/scheduler/check/route.ts');
    const request = (method, body) => new NextRequest('http://localhost/api/scheduler', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    store.savePosts([sample]);
    const response = await api.DELETE(request('DELETE', { id: sample.id })); assert.equal(response.status, 200);
    const draft = (await response.json()).post;
    assert.deepEqual(draft.mediaList, sample.mediaList); assert.equal(draft.scheduledAt, null);
    const future = new Date(Date.now() + 600000).toISOString();
    assert.equal((await api.POST(request('POST', { ...draft, status: 'pending', scheduledAt: future }))).status, 200);
    assert.equal(store.loadPosts().length, 1); assert.equal(store.loadPosts()[0].id, sample.id);
    assert.equal((await api.POST(request('POST', { ...draft, status: 'pending', scheduledAt: 'invalid' }))).status, 400);
    // Hold a publish while cancelling another scheduled post. Completion must
    // merge into fresh storage rather than write the pre-network snapshot.
    store.savePosts([sample, { ...sample, id: 'two' }]);
    let release; let entered;
    const started = new Promise(resolve => { entered = resolve; });
    global.fetch = async () => { entered(); await new Promise(resolve => { release = resolve; }); return new Response('{}', { status: 200 }); };
    const checking = check.POST(); await started;
    assert.equal((await api.DELETE(request('DELETE', { id: 'one' }))).status, 409);
    assert.equal((await api.DELETE(request('DELETE', { id: 'two' }))).status, 200);
    assert.equal((await (await check.POST()).json()).publishedCount, 0);
    release(); assert.equal((await (await checking).json()).publishedCount, 1);
    assert.equal(store.loadPosts().find(p => p.id === 'two').status, 'draft');
    fs.writeFileSync('scheduled-posts.json', '{ broken');
    assert.equal((await api.POST(request('POST', { content: 'safe', status: 'draft', platforms: [] }))).status, 500);
    assert.equal(fs.readFileSync('scheduled-posts.json', 'utf8'), '{ broken');
  } finally { global.fetch = originalFetch; process.chdir(cwd); fs.rmSync(temp, { recursive: true, force: true }); }
});
test('OAuth return binds safe identifier to provider state; no secrets returned', async () => {
  const { startReturn, finishReturn, invalidReturnState, RETURN_COOKIE } = require('../src/lib/oauth-return.ts');
  for (const platform of ['linkedin', 'facebook', 'instagram', 'canva']) {
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'; const state = 'provider-random-state';
    const auth = new NextRequest('https://example.test/api/auth', { headers: { cookie: `${RETURN_COOKIE}=${JSON.stringify({ id, platform })}` } });
    const started = startReturn(auth, NextResponse.redirect('https://provider.test'), state);
    const cookie = started.cookies.get(RETURN_COOKIE).value;
    const request = new NextRequest('https://example.test/api/callback?state=' + state, { headers: { cookie: `${RETURN_COOKIE}=${cookie}` } });
    assert.equal(invalidReturnState(request), false);
    const mismatch = new NextRequest('https://example.test/api/callback?state=wrong', { headers: { cookie: `${RETURN_COOKIE}=${cookie}` } });
    assert.equal(invalidReturnState(mismatch), true);
    const failed = new URL(finishReturn(mismatch, new URL('https://example.test/?connected=true')).headers.get('location'));
    assert.equal(failed.searchParams.get('editor_return'), id);
    assert.equal(failed.searchParams.has('connected'), false);
    assert.match(failed.searchParams.get('error'), /state did not match/);
    const returned = finishReturn(request, new URL('https://example.test/?connected=true&access_token=never&code=never'));
    const location = new URL(returned.headers.get('location'));
    assert.equal(location.pathname, '/oauth-return'); assert.equal(location.searchParams.get('editor_return'), id);
    assert.equal(location.searchParams.get('provider'), platform); assert.equal(location.searchParams.has('access_token'), false); assert.equal(location.searchParams.has('code'), false);
  }
  const gateway = require('../src/app/api/connect/[platform]/route.ts');
  const response = await gateway.GET(new NextRequest('https://example.test/api/connect/whatsapp?return_id=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'), { params: Promise.resolve({ platform: 'whatsapp' }) });
  assert.match(response.headers.get('location'), /OAuth/);
});
test('preview renders images, carousel, video, captions and per-slide accessibility', () => {
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  const Preview = require('../src/app/post-preview.tsx').default;
  for (const name of ['generated', 'upload.png', 'canva-edit', 'with-logo', 'variation']) {
    const html = renderToStaticMarkup(React.createElement(Preview, { post: { ...sample, mediaList: [{ id: 'a', url: 'image', type: 'image', name, altText: 'Visible subject' }] }, edit() {} }));
    assert.match(html, /Visible subject/); assert.match(html, /Instagram|instagram/); assert.match(html, /Full caption/); assert.match(html, /Schedule:/);
  }
  const html = renderToStaticMarkup(React.createElement(Preview, { post: sample, edit() {} })); assert.match(html, /Slide 2/);
  const video = renderToStaticMarkup(React.createElement(Preview, { post: { ...sample, mediaList: [{ id: 'v', url: 'video', type: 'video' }] }, edit() {} })); assert.match(video, /<video/);
});
test('actual Meta route payloads retain per-slide ALT and duplicate protection', async () => {
  const vault = require('../src/app/api/facebook/vault.ts');
  const staging = require('../src/lib/instagram-media.ts');
  const original = { facebook: vault.getFacebookPageToken, instagram: vault.getInstagramAccount, staging: staging.prepareInstagramMedia, fetch: global.fetch };
  vault.getFacebookPageToken = () => ({ pageId: 'page', token: 'fixture-only' });
  vault.getInstagramAccount = () => ({ igUserId: 'ig', token: 'fixture-only' });
  staging.prepareInstagramMedia = async url => url;
  try {
    for (const platform of ['facebook', 'instagram']) {
      const calls = []; let next = 1;
      global.fetch = async (url, options) => {
        const body = options?.body ? JSON.parse(options.body) : null; calls.push({ url: String(url), body });
        return new Response(JSON.stringify(body ? { id: String(next++) } : { status_code: 'FINISHED' }), { status: 200 });
      };
      const api = require('../src/app/api/' + platform + '/publish/route.ts');
      // Deliberately repeat the same image URL with distinct per-slide ALT.
      const url = 'https://fixture.test/photo.jpg';
      const payload = { content: 'Visible caption', userId: 'test', attemptId: 'test-' + platform, isCarousel: true, mediaUrls: [url, url], mediaList: [{ url, type: 'image', altText: 'First slide' }, { url, type: 'image', altText: 'Second slide' }] };
      const request = () => new NextRequest('http://localhost/api/publish', { method: 'POST', body: JSON.stringify(payload) });
      const res = await api.POST(request()); assert.equal(res.status, 200, JSON.stringify(await res.json()));
      const media = calls.filter(c => c.body && (c.body.url || c.body.image_url));
      const field = platform === 'facebook' ? 'alt_text_custom' : 'alt_text';
      assert.deepEqual(media.map(c => c.body[field]), ['First slide', 'Second slide']);
      const count = calls.length; assert.equal((await api.POST(request())).status, 409); assert.equal(calls.length, count);
    }
  } finally { vault.getFacebookPageToken = original.facebook; vault.getInstagramAccount = original.instagram; staging.prepareInstagramMedia = original.staging; global.fetch = original.fetch; }
});
test('ALT endpoint passes actual normalized pixels to vision; invalid input is rejected', async () => {
  const originalFetch = global.fetch; const key = process.env.NVIDIA_API_KEY;
  try {
    process.env.NVIDIA_API_KEY = 'fixture-only';
    const api = require('../src/app/api/media/alt/route.ts');
    const png = await require('sharp')({ create: { width: 10, height: 10, channels: 3, background: '#ff0000' } }).png().toBuffer();
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); const parts = body.messages[0].content;
      assert.match(parts[0].image_url.url, /^data:image\/jpeg;base64,/);
      assert.match(parts[1].text, /actual image/);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'A red square.' } }] }));
    };
    const request = image => new NextRequest('http://localhost/api/media/alt', { method: 'POST', body: JSON.stringify({ image }) });
    const result = await api.POST(request('data:image/png;base64,' + png.toString('base64')));
    assert.equal((await result.json()).altText, 'A red square.');
    assert.equal((await api.POST(request('http://127.0.0.1/private'))).status, 400);
  } finally { global.fetch = originalFetch; if (key === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = key; }
});
