import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYouTubeAuthorizationUrl,
  cancelScheduledYouTubeVideo,
  initiateYouTubeResumableUpload,
  listMyYouTubeChannels,
  refreshYouTubeToken,
  tokenCredentials,
  validateYouTubeMetadata,
  YOUTUBE_SCOPES,
} from '../packages/youtube/index.mjs';
import { createYouTubeRouter } from '../services/integrations-service/providers/youtube/routes.mjs';

const config = {
  clientId: 'test-client', clientSecret: 'test-secret',
  redirectUri: 'http://localhost:3000/api/youtube/callback', enabled: true,
  allowedEmails: new Set(['tester@example.com']),
};

test('authorization URL binds state, requests offline access, and contains only configured YouTube scopes', () => {
  const value = buildYouTubeAuthorizationUrl(config, 'a'.repeat(43));
  const url = new URL(value);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('state'), 'a'.repeat(43));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.match(url.searchParams.get('prompt'), /consent/);
  assert.deepEqual(url.searchParams.get('scope').split(' '), YOUTUBE_SCOPES);
});

test('refresh token is preserved when Google omits a replacement', () => {
  const result = tokenCredentials({ access_token: 'new-access', expires_in: 3600 }, { refreshToken: 'existing-refresh', scope: 'old-scope' });
  assert.equal(result.accessToken, 'new-access');
  assert.equal(result.refreshToken, 'existing-refresh');
  assert.equal(result.scope, 'old-scope');
  assert.ok(Date.parse(result.expiresAt) > Date.now());
});

test('token refresh sends the server-held refresh token without exposing it in a URL', async () => {
  let called;
  const fetchMock = async (url, init) => {
    called = { url: String(url), init };
    return Response.json({ access_token: 'refreshed', expires_in: 3600 });
  };
  const result = await refreshYouTubeToken(config, 'refresh-secret', fetchMock);
  assert.equal(result.access_token, 'refreshed');
  assert.equal(called.url, 'https://oauth2.googleapis.com/token');
  assert.equal(new URLSearchParams(called.init.body).get('refresh_token'), 'refresh-secret');
  assert.ok(!called.url.includes('refresh-secret'));
});

test('channels.list uses mine=true and returns only channels in the provider response', async () => {
  const channels = await listMyYouTubeChannels('access', async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('mine'), 'true');
    assert.equal(init.headers.authorization, 'Bearer access');
    return Response.json({ items: [
      { id: 'UC1', snippet: { title: 'Primary', thumbnails: { default: { url: 'https://img/1' } } }, status: { privacyStatus: 'public' } },
      { id: 'UC2', snippet: { title: 'Authorized Brand' }, status: { privacyStatus: 'private' } },
    ] });
  });
  assert.deepEqual(channels.map((item) => item.id), ['UC1', 'UC2']);
  assert.equal(channels[0].name, 'Primary');
});

test('metadata validation enforces limits and schedules as private using an ISO instant', () => {
  const now = Date.now();
  const valid = validateYouTubeMetadata({ title: 'Launch film', description: 'Description', tags: 'launch, product', privacyStatus: 'public', publishAt: new Date(now + 3600_000).toISOString() }, now);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.privacyStatus, 'private');
  assert.equal(valid.value.requestedPrivacyStatus, 'public');
  assert.deepEqual(valid.value.tags, ['launch', 'product']);
  assert.equal(validateYouTubeMetadata({ title: '', privacyStatus: 'private' }, now).code, 'YOUTUBE_TITLE_REQUIRED');
  assert.equal(validateYouTubeMetadata({ title: 'x'.repeat(101), privacyStatus: 'private' }, now).code, 'YOUTUBE_TITLE_TOO_LONG');
  assert.equal(validateYouTubeMetadata({ title: 'ok', publishAt: new Date(now + 60_000).toISOString() }, now).code, 'YOUTUBE_SCHEDULE_INVALID');
});

test('resumable initiation sends metadata and upload size, returning only the provider session URL to the server caller', async () => {
  const sessionUrl = await initiateYouTubeResumableUpload({
    accessToken: 'access', mimeType: 'video/mp4', size: 1234,
    metadata: { title: 'Demo', description: 'Body', tags: ['demo'], privacyStatus: 'private', publishAt: null, madeForKids: false },
  }, async (url, init) => {
    assert.match(String(url), /upload\/youtube\/v3\/videos/);
    assert.equal(init.headers['x-upload-content-length'], '1234');
    assert.equal(JSON.parse(init.body).snippet.title, 'Demo');
    return new Response(null, { status: 200, headers: { location: 'https://upload.youtube.test/resumable/opaque' } });
  });
  assert.equal(sessionUrl, 'https://upload.youtube.test/resumable/opaque');
});

test('schedule cancellation updates the existing video to private', async () => {
  let body;
  await cancelScheduledYouTubeVideo('access', 'video123', async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ id: 'video123' });
  });
  assert.deepEqual(body, { id: 'video123', status: { privacyStatus: 'private' } });
});

class FakeResponse {
  constructor() { this.statusCode = 0; this.headers = new Map(); this.body = ''; }
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); }
  getHeader(name) { return this.headers.get(name.toLowerCase()); }
  writeHead(status, headers = {}) { this.statusCode = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); }
  end(value = '') { this.body += value; }
}

class FakePool {
  constructor() { this.handshakes = new Map(); this.connection = null; }
  async query(sql, args = []) {
    if (sql.includes('INSERT INTO oauth_handshakes')) { this.handshakes.set(args[3], { user_id: args[1], data: JSON.parse(args[4]) }); return { rows: [] }; }
    if (sql.includes('DELETE FROM oauth_handshakes')) { const row = this.handshakes.get(args[0]); this.handshakes.delete(args[0]); return { rows: row ? [row] : [] }; }
    if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'tester@example.com' }] };
    if (sql.includes("platform = 'youtube'") && sql.includes('SELECT id')) return { rows: this.connection ? [this.connection] : [] };
    if (sql.includes('INSERT INTO platform_connections')) {
      this.connection = { id: args[0], user_id: args[1], provider_user_id: args[2], display_name: args[3], credentials: JSON.parse(args[4]), meta: JSON.parse(args[5]) };
      return { rows: [{ id: args[0], user_id: args[1] }] };
    }
    throw new Error(`Unhandled SQL in test: ${sql.slice(0, 80)}`);
  }
}

function request(url, headers = {}) { return { method: 'GET', url, headers, async *[Symbol.asyncIterator]() {} }; }

test('OAuth callback consumes state once, exchanges server-side, retrieves mine=true channel, and saves user-scoped credentials', async () => {
  const pool = new FakePool();
  let providerCalls = 0;
  const fetchMock = async (url) => {
    providerCalls++;
    if (String(url).includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    if (String(url).includes('/youtube/v3/channels')) return Response.json({ items: [{ id: 'UC_TEST', snippet: { title: 'Test Channel' }, status: { privacyStatus: 'public' } }] });
    throw new Error('Unexpected provider URL');
  };
  const router = createYouTubeRouter(pool, { config, fetchImpl: fetchMock });
  const authRes = new FakeResponse();
  await router('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), authRes, { isHttps: false });
  assert.equal(authRes.statusCode, 302);
  const state = new URL(authRes.getHeader('location')).searchParams.get('state');
  assert.ok(state);

  const callbackRes = new FakeResponse();
  await router('/callback', request(`/youtube/callback?code=code&state=${state}`), callbackRes, { isHttps: false });
  assert.equal(callbackRes.statusCode, 302);
  assert.match(callbackRes.getHeader('location'), /connected=true/);
  assert.equal(pool.connection.provider_user_id, 'UC_TEST');
  assert.equal(pool.connection.credentials.refreshToken, 'refresh');
  assert.equal(providerCalls, 2);

  const replayRes = new FakeResponse();
  await router('/callback', request(`/youtube/callback?code=code&state=${state}`), replayRes, { isHttps: false });
  assert.match(replayRes.getHeader('location'), /state_mismatch/);
  assert.equal(providerCalls, 2, 'a replayed state must not reach Google');
});
