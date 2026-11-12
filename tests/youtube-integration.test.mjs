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
  youtubeConfig,
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

test('schedule cancellation preserves status fields, drops publishAt, and forces private', async () => {
  const calls = [];
  let body;
  const future = new Date(Date.now() + 3600_000).toISOString();
  await cancelScheduledYouTubeVideo('access', 'video123', async (_url, init = {}) => {
    const method = init.method || 'GET';
    calls.push(method);
    if (method === 'GET') {
      return Response.json({ items: [{ id: 'video123', status: { privacyStatus: 'private', publishAt: future, selfDeclaredMadeForKids: true, license: 'creativeCommon', embeddable: false, publicStatsViewable: false } }] });
    }
    body = JSON.parse(init.body);
    return Response.json({ id: 'video123' });
  });
  assert.deepEqual(calls, ['GET', 'PUT'], 'current status must be read before videos.update replaces it');
  assert.equal(body.status.privacyStatus, 'private');
  assert.equal(body.status.publishAt, undefined, 'omitting publishAt is what clears the schedule');
  assert.equal(body.status.selfDeclaredMadeForKids, true);
  assert.equal(body.status.license, 'creativeCommon');
  assert.equal(body.status.embeddable, false);
  assert.equal(body.status.publicStatsViewable, false);
});

test('cancellation refuses a video the provider reports as already public', async () => {
  let putCalls = 0;
  await assert.rejects(
    () => cancelScheduledYouTubeVideo('access', 'video123', async (_url, init = {}) => {
      if ((init.method || 'GET') === 'PUT') { putCalls++; return Response.json({}); }
      return Response.json({ items: [{ id: 'video123', status: { privacyStatus: 'public' } }] });
    }),
    (error) => error.code === 'YOUTUBE_ALREADY_PUBLISHED',
  );
  assert.equal(putCalls, 0, 'a live video must never reach videos.update');
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
    if (sql.includes('UPDATE platform_connections') && sql.includes('provider_user_id')) return { rows: [{ id: 'conn-1' }] };
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

test('auth refuses with a redirect the dashboard can render, never a raw JSON document', async () => {
  const pool = new FakePool();
  const noProvider = async () => { throw new Error('a refused /auth must not reach Google'); };

  const unconfigured = createYouTubeRouter(pool, { config: { ...config, clientId: '' }, fetchImpl: noProvider });
  const missingRes = new FakeResponse();
  await unconfigured('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), missingRes, { isHttps: false });
  assert.equal(missingRes.statusCode, 302);
  const missingTarget = new URL(missingRes.getHeader('location'));
  assert.equal(missingTarget.pathname, '/dashboard');
  assert.equal(missingTarget.searchParams.get('error'), 'youtube_not_configured');

  const disabled = createYouTubeRouter(pool, { config: { ...config, enabled: false }, fetchImpl: noProvider });
  const disabledRes = new FakeResponse();
  await disabled('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), disabledRes, { isHttps: false });
  assert.equal(new URL(disabledRes.getHeader('location')).searchParams.get('error'), 'youtube_disabled');

  const notAllowed = createYouTubeRouter(pool, { config: { ...config, allowedEmails: new Set(['someone-else@example.com']) }, fetchImpl: noProvider });
  const notAllowedRes = new FakeResponse();
  await notAllowed('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), notAllowedRes, { isHttps: false });
  assert.equal(new URL(notAllowedRes.getHeader('location')).searchParams.get('error'), 'youtube_not_available');
});

// --- publishing-service upload router -------------------------------------
const { createYouTubeUploadRouter } = await import('../services/publishing-service/src/youtube-upload.mjs');

const uploadConfig = { ...config, allowedEmails: new Set(['tester@example.com']) };
const UPLOAD_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

class FakeUploadPool {
  constructor({ row = null, connection = null } = {}) { this.row = row; this.connection = connection; this.writes = []; }
  async query(sql, args = []) {
    if (/CREATE TABLE/.test(sql)) return { rows: [] };
    if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: 'tester@example.com' }] };
    if (/WHERE user_id = \$1 AND attempt_id/.test(sql)) return { rows: [] };
    if (/SELECT \* FROM youtube_upload_sessions WHERE id/.test(sql)) return { rows: this.row ? [this.row] : [] };
    if (/status = 'CANCELLED'/.test(sql)) {
      this.writes.push('cancel');
      const allowed = this.row && !['PUBLISHED', 'CANCELLED'].includes(this.row.status);
      return { rows: allowed ? [{ ...this.row, status: 'CANCELLED' }] : [] };
    }
    if (/status = 'FAILED'/.test(sql)) { this.writes.push('fail'); return { rows: [] }; }
    if (/SELECT id, credentials FROM platform_connections/.test(sql)) return { rows: this.connection ? [this.connection] : [] };
    if (/UPDATE platform_connections SET credentials/.test(sql)) return { rows: [] };
    throw new Error(`Unhandled upload SQL: ${sql.slice(0, 60)}`);
  }
}
function jsonRequest(method, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  return { method, url: '/youtube/uploads', headers, async *[Symbol.asyncIterator]() { yield payload; } };
}
const bodyOf = (res) => JSON.parse(res.body);

test('cancelling an already-published upload never privatizes the live video', async () => {
  const pool = new FakeUploadPool({
    row: { id: UPLOAD_ID, user_id: 'user-1', status: 'PUBLISHED', provider_video_id: 'video123', bytes_total: '10', bytes_uploaded: '10', metadata: {}, provider_status: {} },
    connection: { id: 'conn-1', credentials: { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3600_000).toISOString() } },
  });
  let providerCalls = 0;
  const router = createYouTubeUploadRouter(pool, { config: uploadConfig, fetchImpl: async () => { providerCalls++; return Response.json({}); } });
  const res = new FakeResponse();
  await router(`/youtube/uploads/${UPLOAD_ID}`, { method: 'DELETE', headers: {} }, res, 'user-1');
  assert.equal(res.statusCode, 409);
  assert.equal(bodyOf(res).code, 'YOUTUBE_UPLOAD_NOT_CANCELLABLE');
  assert.equal(providerCalls, 0, 'a published video must not be sent to videos.update');
  assert.ok(!pool.writes.includes('cancel'));
});

test('an expired Testing-mode refresh token asks the user to reconnect, not a 500', async () => {
  const pool = new FakeUploadPool({
    connection: { id: 'conn-1', credentials: { accessToken: 'stale', refreshToken: 'revoked', expiresAt: new Date(Date.now() - 1000).toISOString() } },
  });
  const router = createYouTubeUploadRouter(pool, {
    config: uploadConfig,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } }),
  });
  const res = new FakeResponse();
  await router('/youtube/uploads', jsonRequest('POST', { title: 'Launch', size: 1024, mime: 'video/mp4', attemptId: 'attempt-1' }), res, 'user-1');
  assert.equal(res.statusCode, 401);
  assert.equal(bodyOf(res).code, 'YOUTUBE_NOT_CONNECTED');
});

test('a 403 quota refusal is retryable and does not burn the resumable session', async () => {
  const pool = new FakeUploadPool({
    row: { id: UPLOAD_ID, user_id: 'user-1', status: 'INITIATED', upload_url: 'https://upload.youtube.test/session', mime: 'video/mp4', bytes_total: '1000', bytes_uploaded: '0', metadata: {}, provider_status: {} },
  });
  const router = createYouTubeUploadRouter(pool, {
    config: uploadConfig,
    fetchImpl: async () => new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'Quota exceeded' } }), { status: 403, headers: { 'content-type': 'application/json' } }),
  });
  const res = new FakeResponse();
  await router(`/youtube/uploads/${UPLOAD_ID}`, { method: 'PUT', headers: { 'content-range': 'bytes 0-999/1000' } }, res, 'user-1');
  assert.equal(res.statusCode, 429);
  assert.equal(bodyOf(res).code, 'YOUTUBE_QUOTA_EXCEEDED');
  assert.ok(!pool.writes.includes('fail'), 'a transient quota error must not mark the upload FAILED');
});

const SCOPES_WITH_WRITE = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl';
const SCOPES_LEGACY = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload';

function scheduledPool(scope) {
  return new FakeUploadPool({
    row: { id: UPLOAD_ID, user_id: 'user-1', status: 'SCHEDULED', provider_video_id: 'video123', bytes_total: '10', bytes_uploaded: '10', metadata: {}, provider_status: {} },
    connection: { id: 'conn-1', credentials: { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope } },
  });
}
async function cancelUpload(pool, fetchImpl) {
  const router = createYouTubeUploadRouter(pool, { config: uploadConfig, fetchImpl });
  const res = new FakeResponse();
  await router(`/youtube/uploads/${UPLOAD_ID}`, { method: 'DELETE', headers: {} }, res, 'user-1');
  return res;
}

test('a connection predating force-ssl is asked to reconnect, without spending a provider call', async () => {
  const pool = scheduledPool(SCOPES_LEGACY);
  let providerCalls = 0;
  const res = await cancelUpload(pool, async () => { providerCalls++; return Response.json({}); });
  assert.equal(res.statusCode, 403);
  assert.equal(bodyOf(res).code, 'YOUTUBE_REAUTH_REQUIRED');
  assert.equal(providerCalls, 0);
  assert.ok(!pool.writes.includes('cancel'));
});

test('a scheduled upload cancels once force-ssl is granted', async () => {
  const pool = scheduledPool(SCOPES_WITH_WRITE);
  const future = new Date(Date.now() + 3600_000).toISOString();
  const res = await cancelUpload(pool, async (_url, init = {}) => (
    (init.method || 'GET') === 'GET'
      ? Response.json({ items: [{ id: 'video123', status: { privacyStatus: 'private', publishAt: future } }] })
      : Response.json({ id: 'video123' })
  ));
  assert.equal(res.statusCode, 200);
  assert.equal(bodyOf(res).upload.status, 'CANCELLED');
  assert.ok(pool.writes.includes('cancel'));
});

test('a 403 from videos.update is reported as reauth required, not a generic failure', async () => {
  const pool = scheduledPool(SCOPES_WITH_WRITE);
  const future = new Date(Date.now() + 3600_000).toISOString();
  const res = await cancelUpload(pool, async (_url, init = {}) => (
    (init.method || 'GET') === 'GET'
      ? Response.json({ items: [{ id: 'video123', status: { privacyStatus: 'private', publishAt: future } }] })
      : new Response(JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }], message: 'Insufficient Permission' } }), { status: 403, headers: { 'content-type': 'application/json' } })
  ));
  assert.equal(res.statusCode, 403);
  assert.equal(bodyOf(res).code, 'YOUTUBE_REAUTH_REQUIRED');
  assert.ok(!pool.writes.includes('cancel'), 'a failed provider cancel must not mark the row cancelled');
});

test('a provider outage on cancel is a retryable 502, leaving the row untouched', async () => {
  const pool = scheduledPool(SCOPES_WITH_WRITE);
  const future = new Date(Date.now() + 3600_000).toISOString();
  const res = await cancelUpload(pool, async (_url, init = {}) => (
    (init.method || 'GET') === 'GET'
      ? Response.json({ items: [{ id: 'video123', status: { privacyStatus: 'private', publishAt: future } }] })
      : new Response(JSON.stringify({ error: { message: 'Backend Error' } }), { status: 500, headers: { 'content-type': 'application/json' } })
  ));
  assert.equal(res.statusCode, 502);
  assert.equal(bodyOf(res).code, 'YOUTUBE_CANCEL_FAILED');
  assert.ok(!pool.writes.includes('cancel'));
});

async function youtubeStatusFor(scope) {
  const pool = new FakePool();
  pool.connection = {
    id: 'conn-1', user_id: 'user-1', provider_user_id: 'UC1', display_name: 'Primary', meta: {}, disconnected_at: null,
    credentials: { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope },
  };
  const router = createYouTubeRouter(pool, {
    config,
    fetchImpl: async () => Response.json({ items: [{ id: 'UC1', snippet: { title: 'Primary' }, status: { privacyStatus: 'public' } }] }),
  });
  const res = new FakeResponse();
  await router('/status', request('/youtube/status', { 'x-actor-user-id': 'user-1' }), res, { isHttps: false });
  return JSON.parse(res.body);
}

test('status flags a legacy connection for reconnect and clears it once force-ssl is granted', async () => {
  const legacy = await youtubeStatusFor(SCOPES_LEGACY);
  assert.equal(legacy.connected, true, 'the existing connection must survive — the warning never disconnects anyone');
  assert.equal(legacy.scopeUpgradeRequired, true);

  const upgraded = await youtubeStatusFor(SCOPES_WITH_WRITE);
  assert.equal(upgraded.connected, true);
  assert.equal(upgraded.scopeUpgradeRequired, false, 'the warning clears only when the scope is actually present');
});

test('allowlist matching normalizes the stored address the same way it parses the variable', async () => {
  const padded = { ...youtubeConfig({ YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret', YOUTUBE_REDIRECT_URI: 'http://localhost:3000/api/youtube/callback', YOUTUBE_ENABLED: 'true', YOUTUBE_TEST_USER_EMAILS: ' Tester@Example.com , second@example.com ' }) };
  assert.deepEqual([...padded.allowedEmails].sort(), ['second@example.com', 'tester@example.com']);

  // A stored address carrying stray whitespace or mixed case must still match.
  class PaddedEmailPool extends FakePool {
    async query(sql, args) {
      if (sql.includes('SELECT email FROM users')) return { rows: [{ email: '  Tester@Example.COM ' }] };
      return super.query(sql, args);
    }
  }
  const router = createYouTubeRouter(new PaddedEmailPool(), { config: padded, fetchImpl: async () => { throw new Error('unreachable'); } });
  const res = new FakeResponse();
  await router('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), res, { isHttps: false });
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.getHeader('location')).origin, 'https://accounts.google.com', 'an allowlisted user must reach Google');
});

test('an address outside the allowlist is still refused', async () => {
  class OtherEmailPool extends FakePool {
    async query(sql, args) {
      if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'outsider@example.com' }] };
      return super.query(sql, args);
    }
  }
  const router = createYouTubeRouter(new OtherEmailPool(), { config, fetchImpl: async () => { throw new Error('a refused user must not reach Google'); } });
  const res = new FakeResponse();
  await router('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), res, { isHttps: false });
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.getHeader('location')).searchParams.get('error'), 'youtube_not_available');
});

async function callbackFailure({ tokenStatus, channelStatus, storeThrows }) {
  const pool = new FakePool();
  if (storeThrows) {
    const inner = pool.query.bind(pool);
    pool.query = async (sql, args) => {
      if (sql.includes('INSERT INTO platform_connections')) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      return inner(sql, args);
    };
  }
  const logged = [];
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      if (tokenStatus) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: tokenStatus, headers: { 'content-type': 'application/json' } });
      return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    if (channelStatus) return new Response(JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }], message: 'Insufficient Permission' } }), { status: channelStatus, headers: { 'content-type': 'application/json' } });
    return Response.json({ items: [{ id: 'UC_TEST', snippet: { title: 'Test Channel' }, status: { privacyStatus: 'public' } }] });
  };
  // Mirrors the real createLogger signature: ONE object, no message argument.
  const router = createYouTubeRouter(pool, { config, fetchImpl, log: { error: (fields) => logged.push(fields) } });
  const authRes = new FakeResponse();
  await router('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), authRes, { isHttps: false });
  const state = new URL(authRes.getHeader('location')).searchParams.get('state');
  const res = new FakeResponse();
  await router('/callback', request(`/youtube/callback?code=code&state=${state}`), res, { isHttps: false });
  return { error: new URL(res.getHeader('location')).searchParams.get('error'), logged };
}

test('callback failures name the stage that broke and log it without leaking secrets', async () => {
  const exchange = await callbackFailure({ tokenStatus: 400 });
  assert.equal(exchange.error, 'youtube_token_exchange_failed');
  assert.equal(exchange.logged[0].stage, 'token_exchange');
  assert.equal(exchange.logged[0].status, 400);

  const channel = await callbackFailure({ channelStatus: 403 });
  assert.equal(channel.error, 'youtube_channel_fetch_failed');
  assert.equal(channel.logged[0].providerCode, 'insufficientPermissions');

  const store = await callbackFailure({ storeThrows: true });
  assert.equal(store.error, 'youtube_store_failed');
  assert.equal(store.logged[0].stage, 'store');

  // Nothing logged may carry a token, the authorization code, or the state.
  for (const run of [exchange, channel, store]) {
    const dump = JSON.stringify(run.logged);
    for (const secret of ['access', 'refresh', 'code', 'state_key']) {
      assert.ok(!new RegExp(`"[^"]*":"[^"]*${secret}`).test(dump), `log must not carry ${secret}`);
    }
  }
});

test('the real structured logger emits one parseable line carrying no secrets', async () => {
  const { createLogger } = await import('../packages/logger/index.mjs');
  const pool = new FakePool();
  const lines = [];
  let state;
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    const router = createYouTubeRouter(pool, {
      config,
      log: createLogger('integrations-service'),
      fetchImpl: async (url) => (String(url).includes('oauth2.googleapis.com/token')
        ? new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: 400, headers: { 'content-type': 'application/json' } })
        : Response.json({ items: [] })),
    });
    const authRes = new FakeResponse();
    await router('/auth', request('/youtube/auth', { 'x-actor-user-id': 'user-1' }), authRes, { isHttps: false });
    state = new URL(authRes.getHeader('location')).searchParams.get('state');
    const res = new FakeResponse();
    await router('/callback', request(`/youtube/callback?code=SECRET_AUTH_CODE&state=${state}`), res, { isHttps: false });
  } finally {
    console.error = original;
  }

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]); // would throw if the fields were spread as string indices
  assert.equal(entry.event, 'youtube_callback_failed');
  assert.equal(entry.stage, 'token_exchange');
  assert.equal(entry.status, 400);
  assert.equal(entry.service, 'integrations-service');
  assert.ok(!('0' in entry), 'a string passed as fields would spread into numeric keys');
  assert.ok(!lines[0].includes('SECRET_AUTH_CODE'), 'the authorization code must never be logged');
  assert.ok(!lines[0].includes(state), 'the OAuth state must never be logged');
});

test('access-log paths never carry OAuth query parameters, for any provider', async () => {
  const { requestPath } = await import('../packages/logger/index.mjs');
  const cases = [
    ['/api/youtube/callback?code=4/0A_SECRET_CODE&state=STATE_VALUE', '/api/youtube/callback'],
    ['/api/linkedin/callback?code=AQ_SECRET&state=abc', '/api/linkedin/callback'],
    ['/api/facebook/callback?code=SECRET#fragment', '/api/facebook/callback'],
    ['/youtube/callback?code=x', '/youtube/callback'],
    ['/api/youtube/status', '/api/youtube/status'],
    ['', ''],
    [undefined, ''],
    [null, ''],
  ];
  for (const [input, expected] of cases) assert.equal(requestPath(input), expected);

  const logged = requestPath('/api/youtube/callback?code=4/0A_SECRET_CODE&state=STATE_VALUE');
  for (const leak of ['SECRET', 'STATE_VALUE', 'code=', 'state=', '?']) {
    assert.ok(!logged.includes(leak), `access log must not retain "${leak}"`);
  }
});
