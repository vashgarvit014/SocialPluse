// Run with: node --test tests/instagram-collab.cjs
// Instagram collaborator feature, provider-level, mocked Graph API:
//   - professional collaborators are sent to Graph and tracked to Submitted
//   - private collaborators are NEVER sent to Graph (API doesn't support them)
//   - a collaborator-shaped Graph rejection maps to INSTAGRAM_COLLAB_REJECTED
//   - rate limit / auth-expired failures leave collaborators Unknown, not Failed
//   - the existing 3-cap and carousel-parent-only placement still hold
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const instagramProvider = import(pathToFileURL(path.join(root, 'services/publishing-service/providers/instagram.mjs')).href);

const IG = { igUserId: 'ig-user-1', token: 'ig-token' };
const prepare = async (url) => url;

function jsonRes(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function parseBody(raw) {
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function withFetch(route) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: parseBody(init.body) };
    calls.push(call);
    return route(call, calls) || jsonRes({});
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function metaRoute(call) {
  if (call.method === 'POST' && call.url.endsWith('/media_publish')) return jsonRes({ id: 'post-1' });
  if (call.method === 'POST' && call.url.endsWith('/media')) return jsonRes({ id: `container-${Math.random().toString(36).slice(2, 8)}` });
  if (call.method === 'GET' && call.url.includes('fields=status_code')) return jsonRes({ status_code: 'FINISHED' });
  return jsonRes({});
}

test('Instagram collab: professional collaborator is sent to Graph and marked Submitted', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'alice', type: 'professional' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const containerPosts = mock.calls.filter(c => c.method === 'POST' && c.url.endsWith('/media'));
    assert.deepEqual(containerPosts[0].body.collaborators, ['alice']);
    assert.deepEqual(result.collaboratorResults, [{ username: 'alice', type: 'professional', status: 'Submitted' }]);
  } finally { mock.restore(); }
});

test('Instagram collab: private collaborator is never sent to Graph, marked Ready on success', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [
        { username: 'alice', type: 'professional' },
        { username: 'bob', type: 'private' },
      ],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const containerPosts = mock.calls.filter(c => c.method === 'POST' && c.url.endsWith('/media'));
    assert.deepEqual(containerPosts[0].body.collaborators, ['alice'], 'only the professional username reaches Graph');
    const byUsername = Object.fromEntries(result.collaboratorResults.map(r => [r.username, r.status]));
    assert.equal(byUsername.alice, 'Submitted');
    assert.equal(byUsername.bob, 'Ready');
  } finally { mock.restore(); }
});

test('Instagram collab: Graph rejection naming a collaborator maps to INSTAGRAM_COLLAB_REJECTED', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch((call) => {
    if (call.method === 'POST' && call.url.endsWith('/media')) {
      return jsonRes({ error: { message: 'Invalid collaborator: user is not eligible to collaborate', type: 'OAuthException', code: 100 } }, 400);
    }
    return jsonRes({});
  });
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'ineligible_user', type: 'professional' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INSTAGRAM_COLLAB_REJECTED');
    assert.match(result.message, /eligible to collaborate/i);
    assert.deepEqual(result.collaboratorResults, [{ username: 'ineligible_user', type: 'professional', status: 'Failed' }]);
  } finally { mock.restore(); }
});

test('Instagram collab: rate limit (429) leaves collaborators Unknown, not Failed', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch((call) => {
    if (call.method === 'POST' && call.url.endsWith('/media')) return jsonRes({ error: { message: 'rate limited' } }, 429);
    return jsonRes({});
  });
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'alice', type: 'professional' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INSTAGRAM_RATE_LIMIT');
    assert.deepEqual(result.collaboratorResults, [{ username: 'alice', type: 'professional', status: 'Unknown' }]);
  } finally { mock.restore(); }
});

test('Instagram collab: auth expired (401) leaves collaborators Unknown', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch((call) => {
    if (call.method === 'POST' && call.url.endsWith('/media')) return jsonRes({ error: { message: 'token invalid' } }, 401);
    return jsonRes({});
  });
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'alice', type: 'professional' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INSTAGRAM_AUTH_EXPIRED');
    assert.deepEqual(result.collaboratorResults, [{ username: 'alice', type: 'professional', status: 'Unknown' }]);
  } finally { mock.restore(); }
});

test('Instagram collab: input is capped at 3, 4th is dropped before any Graph call', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [
        { username: 'a', type: 'professional' }, { username: 'b', type: 'professional' },
        { username: 'c', type: 'professional' }, { username: 'd', type: 'professional' },
      ],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const containerPosts = mock.calls.filter(c => c.method === 'POST' && c.url.endsWith('/media'));
    assert.equal(containerPosts[0].body.collaborators.length, 3);
    assert.deepEqual(containerPosts[0].body.collaborators, ['a', 'b', 'c']);
    assert.equal(result.collaboratorResults.length, 3);
  } finally { mock.restore(); }
});

test('Instagram collab: carousel places collaborators on the parent container only', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', isCarousel: true,
      mediaUrls: ['https://cdn.example/one.jpg', 'https://cdn.example/two.jpg'],
      mediaList: [
        { url: 'https://cdn.example/one.jpg', type: 'image' },
        { url: 'https://cdn.example/two.jpg', type: 'image' },
      ],
      collaborators: [{ username: 'alice', type: 'professional' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const mediaPosts = mock.calls.filter(c => c.method === 'POST' && c.url.endsWith('/media'));
    const children = mediaPosts.filter(c => c.body?.is_carousel_item === true);
    const parents = mediaPosts.filter(c => c.body?.media_type === 'CAROUSEL');
    assert.ok(!children.some(c => 'collaborators' in c.body), 'no collaborators field on any carousel child');
    assert.equal(parents.length, 1);
    assert.deepEqual(parents[0].body.collaborators, ['alice']);
  } finally { mock.restore(); }
});

test('Instagram collab: permalink is fetched only when a private collaborator needs it', async () => {
  const { publishToInstagram } = await instagramProvider;
  const withPrivate = withFetch((call) => {
    if (call.method === 'GET' && call.url.includes('fields=permalink')) return jsonRes({ permalink: 'https://www.instagram.com/p/abc123/' });
    return metaRoute(call);
  });
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'bob', type: 'private' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.postUrl, 'https://www.instagram.com/p/abc123/');
    assert.ok(withPrivate.calls.some(c => c.method === 'GET' && c.url.includes('fields=permalink')), 'permalink was fetched');
  } finally { withPrivate.restore(); }

  const withoutPrivate = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'alice', type: 'professional' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.postUrl, undefined, 'no permalink lookup when no private collaborator is waiting on it');
    assert.ok(!withoutPrivate.calls.some(c => c.method === 'GET' && c.url.includes('fields=permalink')), 'permalink was not fetched');
  } finally { withoutPrivate.restore(); }
});

test('Instagram collab: permalink lookup failure never fails the publish', async () => {
  const { publishToInstagram } = await instagramProvider;
  const mock = withFetch((call) => {
    if (call.method === 'GET' && call.url.includes('fields=permalink')) return jsonRes({ error: { message: 'boom' } }, 500);
    return metaRoute(call);
  });
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'bob', type: 'private' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.postUrl, undefined, 'falls back gracefully, publish still succeeds');
  } finally { mock.restore(); }
});

test('Instagram collab: MOCK_INSTAGRAM_COLLAB=reject short-circuits without any Graph call', async () => {
  const { publishToInstagram } = await instagramProvider;
  process.env.MOCK_INSTAGRAM_COLLAB = 'reject';
  const mock = withFetch(metaRoute);
  try {
    const result = await publishToInstagram({
      ig: IG, content: 'hello', imageUrl: 'https://cdn.example/a.jpg',
      collaborators: [{ username: 'alice', type: 'professional' }],
      prepareInstagramMedia: prepare,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INSTAGRAM_COLLAB_REJECTED');
    assert.equal(mock.calls.length, 0, 'no real Graph call made in mock mode');
  } finally { mock.restore(); delete process.env.MOCK_INSTAGRAM_COLLAB; }
});
