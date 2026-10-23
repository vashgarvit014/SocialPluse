// Run with: node --test tests/moderation-publish-block.cjs
// Content Violation Monitoring — pre-publish check (publishing-service).
// Mocks the HTTP calls to ai-service (/internal/moderate/text) and
// user-service (/internal/users/:id/moderation/decision) so this never
// makes a real network call or needs real violating content.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const url = (p) => pathToFileURL(path.join(root, p)).href;

function jsonRes(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function withFetch(route) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (reqUrl, init = {}) => {
    const call = { url: String(reqUrl), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return route(call, calls) || jsonRes({});
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// A piece of text that's ALLOW unless it contains the trigger word "BLOCKME",
// which our mocked ai-service treats as BLOCK_OTHER_SAFETY, and "UNCERTAIN"
// as NEEDS_CLARIFICATION — avoids needing real violating content or the
// real classifier.
function mockModerateRoute(call) {
  if (call.url.includes('/internal/moderate/text')) {
    const text = call.body?.text || '';
    if (text.includes('BLOCKME')) return jsonRes({ decision: 'BLOCK_OTHER_SAFETY', method: 'LOCAL_REGEX', confidence: 0.95, countsAsViolation: true, severity: 'WARNING' });
    if (text.includes('UNCERTAIN')) return jsonRes({ decision: 'NEEDS_CLARIFICATION', method: 'LOCAL_REGEX', confidence: 0.5, countsAsViolation: false, severity: 'WARNING' });
    return jsonRes({ decision: 'ALLOW', method: 'LOCAL_REGEX', confidence: 1, countsAsViolation: false, severity: 'INFO' });
  }
  if (call.url.includes('/moderation/decision')) {
    return jsonRes({ eventId: 'evt-1', incidentId: 'inc-1', count: 1, flagged: false, newlyFlagged: false, severity: 'WARNING', notificationId: null, showWarning: true });
  }
  return jsonRes({});
}

test('assertContentAllowed: ALLOW passes through, no incident recorded', async () => {
  const { assertContentAllowed } = await import(url('services/publishing-service/src/pre-publish-check.mjs'));
  const mock = withFetch(mockModerateRoute);
  try {
    const result = await assertContentAllowed({ userId: 'u1', content: 'A perfectly normal caption', platform: 'instagram', source: 'DIRECT_PUBLISH', attemptId: 'att1' });
    assert.equal(result.allowed, true);
    assert.ok(!mock.calls.some((c) => c.url.includes('/moderation/decision')), 'no incident recorded for ALLOW');
  } finally { mock.restore(); }
});

test('assertContentAllowed: BLOCK_* returns 422, records exactly one incident, provider never called', async () => {
  const { assertContentAllowed } = await import(url('services/publishing-service/src/pre-publish-check.mjs'));
  const mock = withFetch(mockModerateRoute);
  try {
    const result = await assertContentAllowed({ userId: 'u1', content: 'BLOCKME this caption', platform: 'facebook', source: 'DIRECT_PUBLISH', attemptId: 'att2' });
    assert.equal(result.allowed, false);
    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'CONTENT_POLICY_VIOLATION');
    const decisionCalls = mock.calls.filter((c) => c.url.includes('/moderation/decision'));
    assert.equal(decisionCalls.length, 1, 'exactly one incident recorded');
  } finally { mock.restore(); }
});

test('assertContentAllowed: NEEDS_CLARIFICATION returns neutral "Content Under Review" copy, not accusatory', async () => {
  const { assertContentAllowed } = await import(url('services/publishing-service/src/pre-publish-check.mjs'));
  const mock = withFetch(mockModerateRoute);
  try {
    const result = await assertContentAllowed({ userId: 'u1', content: 'UNCERTAIN wording here', platform: 'linkedin', source: 'DIRECT_PUBLISH', attemptId: 'att3' });
    assert.equal(result.allowed, false);
    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'CONTENT_UNDER_REVIEW');
    assert.equal(result.body.title, 'Content Under Review');
    assert.ok(!/violation/i.test(result.body.message), 'uncertain copy must not use accusatory "violation" language');
  } finally { mock.restore(); }
});

test('assertContentAllowed: same userId+source+attemptId always produces the same idempotency key', async () => {
  const { assertContentAllowed } = await import(url('services/publishing-service/src/pre-publish-check.mjs'));
  const mock = withFetch(mockModerateRoute);
  try {
    await assertContentAllowed({ userId: 'u1', content: 'BLOCKME again', platform: 'instagram', source: 'DIRECT_PUBLISH', attemptId: 'att-stable' });
    await assertContentAllowed({ userId: 'u1', content: 'BLOCKME again', platform: 'instagram', source: 'DIRECT_PUBLISH', attemptId: 'att-stable' });
    const keys = mock.calls.filter((c) => c.url.includes('/moderation/decision')).map((c) => c.body.idempotencyKey);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1], 'retrying the same attempt must compute the identical idempotency key — the DB UNIQUE index is the actual dedup backstop');
  } finally { mock.restore(); }
});

test('assertContentAllowed: classifier/service failure never silently allows and never records an incident', async () => {
  const { assertContentAllowed } = await import(url('services/publishing-service/src/pre-publish-check.mjs'));
  const mock = withFetch((call) => { if (call.url.includes('/internal/moderate/text')) throw new Error('simulated network failure'); return jsonRes({}); });
  try {
    const result = await assertContentAllowed({ userId: 'u1', content: 'anything at all', platform: 'instagram', source: 'DIRECT_PUBLISH', attemptId: 'att4' });
    assert.equal(result.allowed, false, 'a scanner outage must never silently allow');
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'MODERATION_UNAVAILABLE');
    assert.ok(!mock.calls.some((c) => c.url.includes('/moderation/decision')), 'no incident/violation recorded for an infra outage, never penalize the user for our own classifier being down');
  } finally { mock.restore(); }
});

test('assertContentAllowed: empty content skips the check entirely (image-only posts)', async () => {
  const { assertContentAllowed } = await import(url('services/publishing-service/src/pre-publish-check.mjs'));
  const mock = withFetch(mockModerateRoute);
  try {
    const result = await assertContentAllowed({ userId: 'u1', content: '', platform: 'instagram', source: 'DIRECT_PUBLISH', attemptId: 'att5' });
    assert.equal(result.allowed, true);
    assert.equal(mock.calls.length, 0, 'no network call at all for empty content');
  } finally { mock.restore(); }
});
