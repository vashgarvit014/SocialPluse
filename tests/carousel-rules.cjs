// Run with: node --test tests/carousel-rules.cjs
// Multiple Images ("carousel") 1–9 rules, end to end without network:
//   - shared frontend/backend validation parity (0 rejected, 10+ rejected,
//     1–9 accepted; drafts may save with 0)
//   - provider path selection: a 1-image Multiple Images post uses each
//     platform's single-media path; 2+ uses the carousel/multi path
//   - frontend source guards for the Post Format UI requirements
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

// Transpile hook so the frontend TS rule module can be loaded directly.
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, file) => {
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    });
    module._compile(source.outputText, file);
  };
}

const webRules = require(path.join(root, 'apps/web/src/lib/carousel-rules.ts'));
const backendRules = import(pathToFileURL(path.join(root, 'packages/validation/carousel.mjs')).href);
const instagramProvider = import(pathToFileURL(path.join(root, 'services/publishing-service/providers/instagram.mjs')).href);
const facebookProvider = import(pathToFileURL(path.join(root, 'services/publishing-service/providers/facebook.mjs')).href);
const linkedinProvider = import(pathToFileURL(path.join(root, 'services/publishing-service/providers/linkedin.mjs')).href);

const IG = { igUserId: 'ig-user-1', token: 'ig-token' };
const prepare = async (url) => url;

function jsonRes(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function parseBody(raw) {
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

// Installs a global fetch mock that records every call; `route` maps a call
// to a response (default 200 {}).
function withFetch(route) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: parseBody(init.body) };
    calls.push(call);
    return route(call, calls) || jsonRes({});
  };
  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

// Meta graph router shared by the Instagram single/carousel tests.
function metaRoute(call) {
  if (call.method === 'POST' && call.url.endsWith('/media_publish')) return jsonRes({ id: 'post-1' });
  if (call.method === 'POST' && call.url.endsWith('/media')) return jsonRes({ id: `container-${Math.random().toString(36).slice(2, 8)}` });
  if (call.method === 'GET' && call.url.includes('fields=status_code')) return jsonRes({ status_code: 'FINISHED' });
  return jsonRes({});
}

test('shared rule: min 1, max 9, identical frontend/backend messages', async () => {
  const b = await backendRules;
  assert.equal(b.MIN_CAROUSEL_MEDIA, 1);
  assert.equal(b.MAX_CAROUSEL_MEDIA, 9);
  assert.equal(webRules.MIN_CAROUSEL_MEDIA, b.MIN_CAROUSEL_MEDIA);
  assert.equal(webRules.MAX_CAROUSEL_MEDIA, b.MAX_CAROUSEL_MEDIA);
  assert.equal(webRules.CAROUSEL_MIN_MESSAGE, 'Add at least 1 image.');
  assert.equal(webRules.CAROUSEL_MAX_MESSAGE, 'You can add up to 9 images.');
  // Frontend issue() and backend error() must agree on every boundary.
  const boundaries = [
    [0, webRules.CAROUSEL_MIN_MESSAGE],
    [1, null], [5, null], [9, null],
    [10, webRules.CAROUSEL_MAX_MESSAGE],
  ];
  for (const [count, issue] of boundaries) {
    assert.equal(webRules.carouselMediaIssue(count), issue, `frontend count=${count}`);
    const body = { isCarousel: true, mediaUrls: Array.from({ length: count }, (_, i) => `https://cdn.example/img${i}.jpg`) };
    const err = b.carouselMediaError(body);
    if (issue === null) assert.equal(err, null, `backend count=${count}`);
    else {
      assert.ok(err, `backend count=${count} rejected`);
      assert.equal(err.message, issue, `backend/frontend message parity at count=${count}`);
    }
  }
});

test('backend: carousel validation rejects 0 and 10+, accepts 1–9, ignores non-carousel', async () => {
  const b = await backendRules;
  assert.equal(b.carouselMediaError({ mediaUrls: [] }), null, 'not a carousel request');
  // 0 → rejected
  assert.equal(b.carouselMediaError({ isCarousel: true, mediaUrls: [] }).code, 'CAROUSEL_MEDIA_MIN');
  assert.equal(b.carouselMediaError({ isCarousel: true, mediaList: [] }).message, 'Add at least 1 image.');
  // 1 → accepted (the whole point of this change)
  assert.equal(b.carouselMediaError({ isCarousel: true, mediaUrls: ['https://cdn.example/a.jpg'] }), null);
  assert.equal(b.carouselMediaError({ isCarousel: true, mediaList: [{ url: 'a' }] }), null);
  assert.equal(b.carouselMediaError({ isCarousel: true, mediaUrl: 'https://cdn.example/a.jpg' }), null, 'single media field fallback');
  // 9 → accepted
  assert.equal(b.carouselMediaError({ isCarousel: true, mediaUrls: Array.from({ length: 9 }, (_, i) => `u${i}`) }), null);
  // 10 → rejected
  const ten = b.carouselMediaError({ isCarousel: true, mediaUrls: Array.from({ length: 10 }, (_, i) => `u${i}`) });
  assert.equal(ten.code, 'CAROUSEL_MEDIA_MAX');
  assert.equal(ten.message, 'You can add up to 9 images.');
  // Draft saves: minimum not enforced (a draft may exist before its first
  // slide), but the 9-image ceiling still applies.
  assert.equal(b.carouselMediaError({ isCarousel: true, mediaUrls: [] }, { requireMedia: false }), null);
  assert.ok(b.carouselMediaError({ isCarousel: true, mediaUrls: Array.from({ length: 10 }, (_, i) => `u${i}`) }, { requireMedia: false }));
});

test('Instagram: 1-image Multiple Images publishes via the single-media path', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', isCarousel: true,
      mediaUrls: ['https://cdn.example/one.jpg'],
      mediaList: [{ url: 'https://cdn.example/one.jpg', type: 'image', altText: 'One slide' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const mediaPosts = mock.calls.filter(c => c.method === 'POST' && c.url.endsWith('/media'));
    assert.equal(mediaPosts.length, 1, 'exactly one media container');
    assert.ok(!mediaPosts.some(c => c.body?.is_carousel_item), 'no carousel child container');
    assert.ok(!mediaPosts.some(c => c.body?.media_type === 'CAROUSEL'), 'no CAROUSEL parent container');
    assert.equal(mediaPosts[0].body.image_url, 'https://cdn.example/one.jpg');
    assert.ok(mock.calls.some(c => c.method === 'POST' && c.url.endsWith('/media_publish')), 'published');
  } finally { mock.restore(); }
});

test('Instagram: 2-image Multiple Images still uses the CAROUSEL container path', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', isCarousel: true,
      mediaUrls: ['https://cdn.example/one.jpg', 'https://cdn.example/two.jpg'],
      mediaList: [
        { url: 'https://cdn.example/one.jpg', type: 'image', altText: 'One' },
        { url: 'https://cdn.example/two.jpg', type: 'image', altText: 'Two' },
      ],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const mediaPosts = mock.calls.filter(c => c.method === 'POST' && c.url.endsWith('/media'));
    const children = mediaPosts.filter(c => c.body?.is_carousel_item === true);
    const parents = mediaPosts.filter(c => c.body?.media_type === 'CAROUSEL');
    assert.equal(children.length, 2, 'two carousel children');
    assert.equal(parents.length, 1, 'one CAROUSEL parent');
    assert.equal(parents[0].body.children.length, 2);
  } finally { mock.restore(); }
});

test('Instagram: 0 images rejected, 10 images rejected server-side', async () => {
  const { publishToInstagram } = await instagramProvider;
  const zero = await publishToInstagram({ ig: IG, content: 'x', isCarousel: true, prepareInstagramMedia: prepare });
  assert.equal(zero.ok, false);
  assert.equal(zero.code, 'INSTAGRAM_MEDIA_REQUIRED');

  const urls = Array.from({ length: 10 }, (_, i) => `https://cdn.example/img${i}.jpg`);
  const mock = withFetch(metaRoute);
  try {
    const ten = await publishToInstagram({ ig: IG, content: 'x', isCarousel: true, mediaUrls: urls, prepareInstagramMedia: prepare });
    assert.equal(ten.ok, false);
    assert.equal(ten.code, 'INSTAGRAM_CAROUSEL_MAX');
    assert.equal(ten.message, 'You can add up to 9 images.');
    assert.equal(mock.calls.filter(c => c.method === 'POST').length, 0, 'rejected before any graph call');
  } finally { mock.restore(); }
});

test('Facebook: 1-image Multiple Images uses the single-photo path', async () => {
  const { publishToFacebook } = await facebookProvider;
  const mock = withFetch((call) => {
    if (call.method === 'POST' && call.url.endsWith('/photos')) return jsonRes({ id: 'photo-1', post_id: 'fb-post-1' });
    return jsonRes({});
  });
  try {
    const result = await publishToFacebook({
      targetPageId: 'page-1', pageToken: 'tok', content: 'hello', isCarousel: true,
      mediaUrls: ['https://cdn.example/one.jpg'],
      mediaList: [{ url: 'https://cdn.example/one.jpg', type: 'image' }],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const photoPosts = mock.calls.filter(c => c.method === 'POST' && c.url.endsWith('/photos'));
    assert.equal(photoPosts.length, 1, 'single photo upload');
    assert.ok(!photoPosts.some(c => c.body && 'attached_media' in c.body), 'no multi-photo attached_media');
    assert.equal(photoPosts[0].body.url, 'https://cdn.example/one.jpg');
  } finally { mock.restore(); }
});

test('LinkedIn: 1-image Multiple Images uploads and publishes one image', async () => {
  const { publishToLinkedIn } = await linkedinProvider;
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  const mock = withFetch((call) => {
    if (call.url.includes('action=registerUpload')) {
      return jsonRes({ value: { uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: 'https://upload.example/asset' } }, asset: 'urn:li:digitalmedia:asset:1' } });
    }
    if (call.method === 'PUT' && call.url.includes('upload.example')) return jsonRes({});
    if (call.url.includes('/v2/ugcPosts')) return jsonRes({ id: 'urn:li:share:1' });
    return jsonRes({});
  });
  try {
    const result = await publishToLinkedIn({
      accessToken: 'tok', providerUserId: 'person-1', content: 'hello', isCarousel: true,
      mediaUrls: [dataUrl], mediaList: [{ url: dataUrl, type: 'image' }],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(mock.calls.filter(c => c.url.includes('action=registerUpload')).length, 1, 'one upload registered');
    assert.equal(mock.calls.filter(c => c.url.includes('/v2/ugcPosts')).length, 1, 'one post');
  } finally { mock.restore(); }
});

test('frontend source: Post Format UI meets the 1–9 requirements', () => {
  const wizard = fs.readFileSync(path.join(root, 'apps/web/src/app/_shell/studio-wizard.tsx'), 'utf8');
  // "Supported on" platform banner fully removed from the Post Format card.
  assert.ok(!wizard.includes('Supported on'), 'no "Supported on" block');
  assert.ok(!wizard.includes('supports 2'), 'no "supports 2" copy');
  // Old 2–9 copy removed; recommended copy present.
  assert.ok(!wizard.includes('2–9'), 'no "2–9" string');
  assert.ok(!wizard.includes('Combine 2'), 'no "Combine 2–9" copy');
  assert.ok(wizard.includes('Use up to 9 images in one post.'), 'new Multiple Images copy');
  // User-facing names preserved.
  assert.ok(wizard.includes('Multiple Images'), 'Multiple Images label kept');
  assert.ok(wizard.includes('Single Image'), 'Single Image label kept');
  // AI slides stepper: minimum 1 (decrement disabled at 1), maximum 9.
  assert.ok(wizard.includes('Math.max(1, count - 1)'), 'stepper floors at 1');
  assert.ok(wizard.includes('const atMin = count <= 1'), 'decrement disabled at 1');
  assert.ok(wizard.includes('Math.min(9, count + 1)'), 'stepper caps at 9');
  assert.ok(wizard.includes('const atMax = count >= 9'), 'increment disabled at 9');
  // Branding: "Apply to All Images" only when 2+ images exist.
  assert.ok(wizard.includes('imageCount > 1'), 'apply-to-all gated on 2+ images');
  assert.ok(wizard.includes('Apply Logo to This Image'), 'single-image branding label');
  // Preview: carousel slide nav only renders for 2+ items.
  const previews = ['post-preview.tsx', 'instagram-preview.tsx', 'linkedin-preview.tsx', 'whatsapp-preview.tsx'];
  for (const file of previews) {
    const src = fs.readFileSync(path.join(root, 'apps/web/src/app/_shell', file), 'utf8');
    assert.ok(/length > 1/.test(src), `${file} gates carousel nav behind 2+ items`);
  }
});

test('frontend source: gallery and strip support plain-click selection', () => {
  const wizard = fs.readFileSync(path.join(root, 'apps/web/src/app/_shell/studio-wizard.tsx'), 'utf8');
  // Gallery card click toggles the image in/out of the carousel.
  assert.ok(/onClick=\{e => \{ if \(dragJustEnded\(e\)\) return; setSelectedMediaId\(m\.id\); if \(p\.isCarousel && m\.type === 'image'\) p\.toggleCarouselSlide\(m\.id\)/.test(wizard),
    'gallery click toggles carousel membership');
  // In-carousel gallery cards show a one-click remove (✕) badge.
  assert.ok(/title="Remove from carousel"/.test(wizard), '✕ badge removes from carousel');
  // The ⋯ menu is a two-way toggle (add AND remove).
  assert.ok(wizard.includes("'🎠 Remove from carousel' : '🎠 Add to carousel'"), '⋯ menu toggles add/remove');
  // Strip slide: click removes it (menus remain as fallback).
  assert.ok(/onClick=\{e => \{ if \(dragJustEnded\(e\)\) return; p\.removeCarouselSlide\(m\.id\); \}\}/.test(wizard),
    'strip slide click removes it');
  // Drag-end guard so reordering never counts as a click.
  assert.ok(wizard.includes('const dragJustEnded = (e: { timeStamp: number })'), 'drag-vs-click guard present');
  assert.ok(wizard.includes('lastDragEndAtRef.current = e.timeStamp'), 'drag end timestamps the guard');
});

test('frontend source: carousel validation is the shared 1–9 rule', () => {
  const smm = fs.readFileSync(path.join(root, 'apps/web/src/app/_shell/social-media-manager.tsx'), 'utf8');
  assert.ok(smm.includes('carouselMediaIssue'), 'uses the shared rule');
  assert.ok(!smm.includes('at least 2'), 'no min-2 message left');
  assert.ok(!smm.includes('carouselSlides.length < 2'), 'no slide-count min-2 gate left');
  assert.ok(smm.includes('carouselSlides.length < 1') || smm.includes('carouselMediaIssue(carouselSlides.length)'), 'min-1 validation in place');
  // Gallery/publish caps stay at 9.
  assert.ok(smm.includes('.slice(0, 9)'), 'publish list capped at 9');
  const provider = fs.readFileSync(path.join(root, 'services/publishing-service/providers/instagram.mjs'), 'utf8');
  assert.ok(!provider.includes('INSTAGRAM_CAROUSEL_MIN'), 'min-2 carousel error removed');
  assert.ok(provider.includes('orderedUrls.length > 1'), 'carousel path requires 2+ images');
  assert.ok(provider.includes('slides.length > 9'), 'carousel path capped at 9');
});
