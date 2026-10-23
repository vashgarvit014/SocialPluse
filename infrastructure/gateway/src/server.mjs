import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../packages/logger/index.mjs';
import { internalFetchHeaders } from '../packages/service-auth/index.mjs';

// socialpulse-gateway — thin router only, no business logic (per migration
// plan). Two jobs:
//
//  1. Own the new /api/analytics/* prefix and forward it to analytics-service,
//     with a request timeout, a tiny circuit breaker, and a graceful
//     "temporarily unavailable" JSON response on failure.
//  2. Pass everything else through unchanged to the existing monolith
//     (socialpulse:3000) so this is additive — it does not replace or modify
//     the live app's existing routes/behavior, just sits in front of it on a
//     new, separate port. Cloudflare/production routing is untouched; this
//     gateway is reachable only via a new local port for now.

const PORT = Number(process.env.PORT || 8080);
const WEB_UPSTREAM = process.env.WEB_UPSTREAM || 'http://socialpulse:3000';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:4008';
const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL || 'http://admin-service:4009';
const MEDIA_SERVICE_URL = process.env.MEDIA_SERVICE_URL || 'http://media-service:4004';
const PUBLISHING_SERVICE_URL = process.env.PUBLISHING_SERVICE_URL || 'http://publishing-service:4006';
const SCHEDULER_SERVICE_URL = process.env.SCHEDULER_SERVICE_URL || 'http://scheduler-service:4007';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:4003';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:4010';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:4011';
const INTEGRATIONS_SERVICE_URL = process.env.INTEGRATIONS_SERVICE_URL || 'http://integrations-service:4005';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
// Was 5000. /otp/request and /password/forgot send a real email inline, and
// this deployment's SMTP relay measures ~6.5s for a cold handshake and
// ~2-3s warm. At 5s the gateway aborted first and returned a bare 503, so the
// browser never received a challengeId even though the mail arrived — the user
// got an email they could not use. Healthy services answer in milliseconds, so
// this only bounds how long a genuinely hung upstream is tolerated.
const SERVICE_TIMEOUT_MS = 15000;

// Synchronous LLM routes need far more headroom than the SMTP-tuned value
// above. /content is NOT a fast route: it waits for the whole text-generation
// call to finish before responding (ai-service has no job queue for it, unlike
// /image which returns 202 and is polled). Measured against ai_usage_log over
// 8h: 15 CONTENT calls, avg 17.3s, max 84.7s, and 40% of them exceeded 15s.
//
// At the old 15s bound those requests were aborted mid-flight, answered to the
// browser as a bare 503 ("This operation was aborted"), and — because three in
// a row tripped the breaker — took the following calls down with them for
// another 15s each. The AI service was healthy the whole time; the gateway was
// simply cancelling work that was still legitimately in progress.
//
//
// 90s, not 120s: the app is served through Cloudflare's proxy (responses carry
// `server: cloudflare` and a cf-ray), and Cloudflare aborts a proxied request at
// 100s with an opaque 524. Staying under that means the slow tail produces our
// own 503 with a readable message instead of a bare Cloudflare error. It still
// clears the slowest observed call (84.7s), and it is only a ceiling on a hung
// request, never a target - typical calls return in their own latency, so
// nothing gets slower by raising the bound.
const AI_LONG_TIMEOUT_MS = 90000;

// Publishing routes are synchronous multi-step Meta calls: Instagram
// container creation + waitForContainer polling (up to 12x3s) + media_publish
// routinely exceeds 15s. At 15s the gateway aborted first (503
// PUBLISHING_UNAVAILABLE) while publishing-service kept going and actually
// published — a false "Failed" for a live post. 75s stays under Cloudflare's
// 100s proxy abort, same reasoning as AI_LONG_TIMEOUT_MS above.
const PUBLISH_TIMEOUT_MS = 75000;

const log = createLogger('gateway');

// --- minimal circuit breaker, one instance per upstream service ---
function createBreaker(name, { failureThreshold = 3, cooldownMs = 15_000 } = {}) {
  let consecutiveFailures = 0;
  let openedAt = 0;
  return {
    isOpen() {
      if (consecutiveFailures < failureThreshold) return false;
      if (Date.now() - openedAt > cooldownMs) {
        // Half-open: let the next call through to test recovery.
        consecutiveFailures = failureThreshold - 1;
        return false;
      }
      return true;
    },
    recordSuccess() { consecutiveFailures = 0; },
    recordFailure() {
      consecutiveFailures += 1;
      if (consecutiveFailures === failureThreshold) {
        openedAt = Date.now();
        log.warn({ event: 'circuit_open', upstream: name });
      }
    },
  };
}
const analyticsBreaker = createBreaker('analytics-service');
const adminBreaker = createBreaker('admin-service');
const integrationsBreaker = createBreaker('integrations-service');
const canvaBreaker = createBreaker('integrations-canva');
const linkedinBreaker = createBreaker('integrations-linkedin');
const facebookBreaker = createBreaker('integrations-facebook');
const instagramBreaker = createBreaker('integrations-instagram');
const whatsappBreaker = createBreaker('integrations-whatsapp');
const mediaBreaker = createBreaker('media-service');
const publishingBreaker = createBreaker('publishing-service');
const schedulerBreaker = createBreaker('scheduler-service');
const aiBreaker = createBreaker('ai-service');
const userBreaker = createBreaker('user-service');
const authBreaker = createBreaker('auth-service');

// auth-service (Phase 9, this round). Maps the existing frontend paths
// directly. skipAuth: true on every one of these — auth-service does its
// own session/role gating internally by reading the forwarded Cookie
// header itself (it IS the thing that defines "authenticated" now); the
// gateway's job here is only to proxy the cookie faithfully, not to
// pre-authenticate against itself.
const AUTH_ROUTES = new Map([
  ['/api/auth/signup', '/signup'],
  ['/api/auth/login', '/login'],
  ['/api/auth/logout', '/logout'],
  ['/api/auth/me', '/me'],
  ['/api/auth/otp/request', '/otp/request'],
  ['/api/auth/otp/verify', '/otp/verify'],
  ['/api/auth/otp/resend', '/otp/resend'],
  ['/api/auth/password/forgot', '/password/forgot'],
  ['/api/auth/password/reset', '/password/reset'],
  ['/api/superadmin/auth/login', '/superadmin/login'],
  ['/api/superadmin/auth/check', '/superadmin/check'],
  ['/api/superadmin/settings/password', '/superadmin/settings/password'],
  ['/api/superadmin/settings/email/request', '/superadmin/settings/email/request'],
  ['/api/superadmin/settings/email/verify', '/superadmin/settings/email/verify'],
  ['/api/superadmin/settings/email/resend', '/superadmin/settings/email/resend'],
]);

const SUPERADMIN_ADMIN_ROUTES = new Map([
  ['/api/superadmin/audit-logs', '/audit-logs'],
  ['/api/superadmin/auth-activity', '/auth-events/filtered'],
  ['/api/superadmin/connections', '/connections'],
  ['/api/superadmin/notifications', '/notifications'],
  ['/api/superadmin/publishing', '/publishing'],
  ['/api/superadmin/sessions', '/sessions'],
  ['/api/superadmin/system-health', '/system-health'],
]);

// ai-service (Phase 7, this round). Maps the existing frontend paths
// directly (same shape as PUBLISH_ROUTES). Any signed-in user, not
// Superadmin-only — matches the original routes' requireApiSession().
const AI_ROUTES = new Map([
  ['/api/generate-content', '/content'],
  ['/api/generate-image', '/image'],
  // Phase 11 — moved out of the monolith.
  ['/api/vary-image', '/vary-image'],
  ['/api/media/alt', '/alt-text'],
]);

// Publishing (Phase 5, this round). Maps the existing frontend paths to
// publishing-service's per-provider routes. All session-gated — no
// skipAuth entries, publishing always requires a real caller.
const PUBLISH_ROUTES = new Map([
  ['/api/linkedin/publish', '/linkedin'],
  ['/api/facebook/publish', '/facebook'],
  ['/api/instagram/publish', '/instagram'],
  ['/api/whatsapp/publish', '/whapi'],
  ['/api/whapi/publish', '/whapi'],
]);

// Phase 3B: Canva's real OAuth lifecycle, now owned by integrations-service
// (providers/canva/*) instead of proxied to the monolith's own routes.
// /api/canva/export is deliberately absent here — it still falls through to
// proxyToWeb below (monolith), since it depends on media-service logic that
// doesn't exist yet. See MIGRATION-NOTES.md.
const CANVA_ROUTES = new Map([
  ['/api/canva/auth', { skipAuth: false }],
  // No session gate: Canva's redirect lands here as a third-party top-level
  // navigation; identity comes from the PKCE row keyed by `state`, exactly
  // like the monolith's original /api/canva/callback route.
  ['/api/canva/callback', { skipAuth: true }],
  ['/api/canva/return', { skipAuth: false }],
  ['/api/canva/status', { skipAuth: false }],
  ['/api/canva/disconnect', { skipAuth: false }],
  ['/api/canva/create-design', { skipAuth: false }],
  ['/api/canva/create-blank', { skipAuth: false }],
  ['/api/canva/export', { skipAuth: false }],
]);

// LinkedIn (Phase 3B, this round). /api/linkedin/publish is deliberately
// absent — publishing stays in the monolith until publishing-service exists.
const LINKEDIN_ROUTES = new Map([
  ['/api/linkedin/auth', { skipAuth: false }],
  ['/api/linkedin/callback', { skipAuth: true }], // identity comes from oauth_handshakes state, not the session
  ['/api/linkedin/status', { skipAuth: false }],
  ['/api/linkedin/disconnect', { skipAuth: false }],
]);

// Facebook (Phase 3B, this round). /api/facebook/publish deliberately
// absent — publishing stays in the monolith until publishing-service exists.
const FACEBOOK_ROUTES = new Map([
  ['/api/facebook/auth', { skipAuth: false }],
  ['/api/facebook/callback', { skipAuth: true }], // identity from oauth_handshakes state, not the session
  ['/api/facebook/status', { skipAuth: false }],
  ['/api/facebook/disconnect', { skipAuth: false }],
]);

// Instagram (Phase 3B, this round). No auth/callback entries: Instagram has
// no independent OAuth (confirmed by auditing the monolith first — see
// providers/instagram/routes.mjs) — /api/instagram/auth and /callback fall
// through to proxyToWeb below, unchanged (thin redirect / dead route).
// /api/instagram/publish and /media/[id] also absent — publishing/media
// stay in the monolith until their services exist.
const INSTAGRAM_ROUTES = new Map([
  ['/api/instagram/status', { skipAuth: false }],
  ['/api/instagram/disconnect', { skipAuth: false }],
  // Clears the user's Instagram opt-out and re-arms the scheduled rows the
  // disconnect marked CONNECTION_REQUIRED (see providers/instagram/routes.mjs).
  ['/api/instagram/reconnect', { skipAuth: false }],
]);

// WhatsApp/Whapi (Phase 3B, this round). All session-gated — no callback
// equivalent here (QR pairing, not OAuth redirect). /api/whapi/groups and
// /api/whapi/destinations deliberately absent — still Phase 3A passthrough/
// proxy (see providers/whatsapp/routes.mjs for why). /api/whatsapp/publish,
// /api/whapi/publish, both webhooks, and /api/whapi/media/[id] also absent —
// all stay on the monolith this round.
const WHATSAPP_ROUTES = new Map([
  ['/api/whatsapp/connect', { skipAuth: false }],
  ['/api/whatsapp/status', { skipAuth: false }],
  ['/api/whatsapp/cancel', { skipAuth: false }],
  ['/api/whatsapp/disconnect', { skipAuth: false }],
  ['/api/whatsapp/communities', { skipAuth: false }],
  ['/api/whatsapp/groups', { skipAuth: false, targetPath: '/whatsapp/groups' }],
  ['/api/whatsapp/send-message', { skipAuth: false, targetPath: '/whatsapp/send-message' }],
  ['/api/whatsapp/webhook', { skipAuth: true, targetPath: '/whatsapp/webhook' }],
  ['/api/whapi/status', { skipAuth: false, targetPath: '/status/whapi' }],
  ['/api/whapi/groups', { skipAuth: false, targetPath: '/whapi/groups' }],
  ['/api/whapi/destinations', { skipAuth: false, targetPath: '/whapi/destinations' }],
  ['/api/whapi/webhook', { skipAuth: true, targetPath: '/whapi/webhook' }],
]);

// --- session auth, delegated to auth-service (Phase 9 cutover) ---
//
// THIS REPLACES the monolith's /api/internal/verify-session. auth-service
// is now the sole authority on session validity/role/account status — the
// monolith is no longer called for gateway authentication at all. Every
// already-extracted service's trust boundary runs through this one
// function: it is called before every proxyToService call below.
//
// Also carries forward a short-lived, signed internal identity assertion
// (x-identity-assertion) from auth-service — additive, not yet verified by
// any downstream service (see MIGRATION-NOTES.md Phase 9's "internal
// identity assertion" section for what this does and does not cover yet).
// The existing x-actor-user-id/x-actor-role + internal-secret trust model
// remains the ENFORCED mechanism; this is a documented incremental step,
// not a completed rewrite of every service's trust model.
async function authenticateRequest(req, requestId, { requireRole } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVICE_TIMEOUT_MS);
  try {
    const upstreamRes = await fetch(`${AUTH_SERVICE_URL}/internal/verify-session`, {
      headers: {
        cookie: req.headers.cookie || '',
        'x-internal-secret': INTERNAL_SECRET,
        'x-request-id': requestId,
      },
      signal: controller.signal,
    });
    const data = await upstreamRes.json().catch(() => ({}));
    if (!data.authenticated) return { ok: false, status: 401, body: { code: 'UNAUTHORIZED', message: 'Sign in required.' } };
    if (requireRole && data.role !== requireRole) {
      return { ok: false, status: 403, body: { code: 'FORBIDDEN', message: 'You do not have access to this resource.' } };
    }
    return { ok: true, userId: data.userId, role: data.role, accountStatus: data.accountStatus, identityAssertion: data.identityAssertion };
  } catch (err) {
    log.warn({ requestId, event: 'session_check_failed', message: err instanceof Error ? err.message : 'unknown' });
    // Fail closed: if we can't verify the session, we don't grant access.
    return { ok: false, status: 401, body: { code: 'UNAUTHORIZED', message: 'Could not verify your session. Please try again.' } };
  } finally {
    clearTimeout(timer);
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Generic proxy to an extracted service, gated by session auth + a
// per-service circuit breaker. Both analytics and admin routes are
// SUPERADMIN-only right now (mirrors their existing monolith routes'
// requireApiSuperadmin() checks) — a future non-admin service passes
// requireRole: undefined instead.
async function proxyToService(req, res, requestId, { name, baseUrl, breaker, prefix, targetPath, requireRole, unavailableCode, unavailableMessage, forwardCookie, skipAuth, timeoutMs }) {
  const auth = skipAuth ? { ok: true, userId: undefined, role: undefined } : await authenticateRequest(req, requestId, { requireRole });
  if (!auth.ok) return send(res, auth.status, auth.body);

  if (breaker.isOpen()) {
    return send(res, 503, { code: unavailableCode, message: unavailableMessage });
  }
  // targetPath: an explicit 1:1 path mapping (e.g. "/api/linkedin/publish"
  // -> "/linkedin") for routes that don't share a prefix shape with the
  // downstream service. Falls back to prefix-stripping otherwise.
  // Bug fixed alongside the body-forwarding one above: a root-level request
  // with only a query string (e.g. "/api/media-assets?all=1") left subpath
  // as "?all=1" with no leading slash, producing an invalid upstream URL.
  // Bug fixed while wiring ai-service: a fixed targetPath dropped the
  // original query string entirely, breaking "GET /api/generate-image?jobId=..."
  // (the poll endpoint) — found by tracing the request shape before testing,
  // not after a live failure this time.
  const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  let subpath = targetPath ? `${targetPath}${queryString}` : req.url.replace(prefix, '');
  if (!subpath || subpath[0] !== '/') subpath = `/${subpath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || SERVICE_TIMEOUT_MS);
  try {
    const extraHeaders = {};
    if (auth.userId) extraHeaders['x-actor-user-id'] = auth.userId;
    if (auth.role) extraHeaders['x-actor-role'] = auth.role;
    // Additive, not yet verified downstream — see authenticateRequest()'s
    // own comment.
    if (auth.identityAssertion) extraHeaders['x-identity-assertion'] = auth.identityAssertion;
    // auth-service's IP-based rate limiting (login/signup/OTP attempts)
    // needs the real client IP, which was never forwarded to any
    // downstream service before this — pass through whatever the browser's
    // hop already set (Cloudflare, in production) so it isn't silently
    // "unknown" for every caller once this gateway is actually cut over.
    if (req.headers['x-forwarded-for']) extraHeaders['x-forwarded-for'] = req.headers['x-forwarded-for'];
    // integrations-service (Phase 3A) still forwards this to the monolith's
    // own status routes, which run requireApiSession() themselves — the
    // gateway's check above is an additional gate, not a replacement.
    if (forwardCookie && req.headers.cookie) extraHeaders.cookie = req.headers.cookie;
    // BUG FIXED (found while wiring media upload): this never forwarded the
    // request body or its real content-type, so every POST route built in
    // earlier rounds (Canva/LinkedIn/Facebook/WhatsApp disconnect, etc.) was
    // silently broken for an authenticated caller — untested until now
    // because every prior test hit the 401 gate first and never reached
    // this code. internalFetchHeaders sets a default 'content-type':
    // 'application/json', which must NOT override multipart's own boundary.
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const bodyBuf = hasBody ? await readBody(req) : undefined;
    if (hasBody && req.headers['content-type']) extraHeaders['content-type'] = req.headers['content-type'];
    const upstreamRes = await fetch(`${baseUrl}${subpath}`, {
      method: req.method,
      // x-actor-* are informational (logging/future use) — the actual trust
      // boundary is x-internal-secret, verified by the service itself.
      headers: internalFetchHeaders(INTERNAL_SECRET, requestId, extraHeaders),
      body: bodyBuf,
      signal: controller.signal,
      // CRITICAL: Canva's callback (and others) return a 302 to an absolute
      // URL the BROWSER must follow. Without 'manual', undici's fetch
      // silently follows it itself — including across to the live
      // socialpulse.dotstark.tech domain — and this proxy would relay that
      // final page back instead of the redirect, breaking the OAuth flow
      // invisibly (found via a real test: callback returned the production
      // login page instead of a 302).
      redirect: 'manual',
    });
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    breaker.recordSuccess();
    // Forward headers verbatim (Location for redirects, Set-Cookie for
    // token/session cookies — Canva's auth/callback/status/disconnect routes
    // depend on both). getSetCookie() keeps multiple Set-Cookie values
    // distinct; headers.forEach() would otherwise comma-join them, which
    // browsers can't parse back into separate cookies.
    const outHeaders = {};
    upstreamRes.headers.forEach((v, k) => { if (!['content-encoding', 'set-cookie'].includes(k.toLowerCase())) outHeaders[k] = v; });
    const setCookies = upstreamRes.headers.getSetCookie ? upstreamRes.headers.getSetCookie() : [];
    if (setCookies.length) outHeaders['set-cookie'] = setCookies;
    res.writeHead(upstreamRes.status, outHeaders);
    res.end(buf);
  } catch (err) {
    breaker.recordFailure();
    log.warn({ requestId, event: `${name}_proxy_failed`, message: err instanceof Error ? err.message : 'unknown' });
    send(res, 503, { code: unavailableCode, message: unavailableMessage });
  } finally {
    clearTimeout(timer);
  }
}

// Passthrough to the existing monolith — unchanged behavior, just relayed.
// No circuit breaker here deliberately: the web app is the whole product,
// not one degradable feature, so we don't want to "fail fast" in front of it.
async function proxyToWeb(req, res, requestId) {
  const bodyBuf = (req.method !== 'GET' && req.method !== 'HEAD') ? await readBody(req) : undefined;
  // Hop-by-hop / connection-specific headers must not be forwarded verbatim -
  // "host" in particular would make the upstream fetch target the wrong vhost.
  const forwardHeaders = { 'x-request-id': requestId };
  for (const [key, value] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length'].includes(key.toLowerCase()) || value === undefined) continue;
    forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  try {
    const upstreamRes = await fetch(`${WEB_UPSTREAM}${req.url}`, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyBuf,
      // Same reasoning as proxyToService: the monolith issues real redirects
      // (OAuth starts, login gates, etc.) that the BROWSER must follow, not
      // this relay — auto-following would silently swap the real response
      // for whatever page the redirect target renders.
      redirect: 'manual',
    });
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    const headers = {};
    upstreamRes.headers.forEach((v, k) => { if (!['content-encoding', 'set-cookie'].includes(k.toLowerCase())) headers[k] = v; });
    const setCookies = upstreamRes.headers.getSetCookie ? upstreamRes.headers.getSetCookie() : [];
    if (setCookies.length) headers['set-cookie'] = setCookies;
    res.writeHead(upstreamRes.status, headers);
    res.end(buf);
  } catch (err) {
    log.warn({ requestId, event: 'web_proxy_failed', message: err instanceof Error ? err.message : 'unknown' });
    send(res, 503, { code: 'WEB_UNAVAILABLE', message: 'SocialPulse is temporarily unavailable. Please try again shortly.' });
  }
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', requestId);
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  if (req.url === '/health') {
    return send(res, 200, { service: 'gateway', status: 'ok', timestamp: new Date().toISOString() });
  }

  if (req.url === '/health/aggregate') {
    const results = {};
    for (const [name, url] of [
      ['web', `${WEB_UPSTREAM}/`],
      ['analytics-service', `${ANALYTICS_SERVICE_URL}/health`],
      ['admin-service', `${ADMIN_SERVICE_URL}/health`],
      ['integrations-service', `${INTEGRATIONS_SERVICE_URL}/health`],
      ['media-service', `${MEDIA_SERVICE_URL}/health`],
      ['publishing-service', `${PUBLISHING_SERVICE_URL}/health`],
      ['scheduler-service', `${SCHEDULER_SERVICE_URL}/health`],
      ['ai-service', `${AI_SERVICE_URL}/health`],
      ['user-service', `${USER_SERVICE_URL}/health`],
      ['auth-service', `${AUTH_SERVICE_URL}/health`],
    ]) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 2000);
        const r = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(t));
        results[name] = r.ok ? 'ok' : `http_${r.status}`;
      } catch {
        results[name] = 'unreachable';
      }
    }
    return send(res, 200, { service: 'gateway', timestamp: new Date().toISOString(), upstreams: results });
  }

  const pathnameOnly = req.url.split('?')[0];

  if (req.url.startsWith('/api/analytics/')) {
    return proxyToService(req, res, requestId, {
      name: 'analytics', baseUrl: ANALYTICS_SERVICE_URL, breaker: analyticsBreaker,
      prefix: /^\/api\/analytics/, requireRole: 'SUPERADMIN',
      unavailableCode: 'ANALYTICS_UNAVAILABLE', unavailableMessage: 'Analytics are temporarily unavailable.',
    });
  }

  if (pathnameOnly === '/api/superadmin/ai-usage') {
    return proxyToService(req, res, requestId, {
      name: 'analytics', baseUrl: ANALYTICS_SERVICE_URL, breaker: analyticsBreaker,
      targetPath: '/ai-usage', requireRole: 'SUPERADMIN',
      unavailableCode: 'ANALYTICS_UNAVAILABLE', unavailableMessage: 'Analytics are temporarily unavailable.',
    });
  }

  if (req.url.startsWith('/api/admin/')) {
    return proxyToService(req, res, requestId, {
      name: 'admin', baseUrl: ADMIN_SERVICE_URL, breaker: adminBreaker,
      prefix: /^\/api\/admin/, requireRole: 'SUPERADMIN',
      unavailableCode: 'ADMIN_SERVICE_UNAVAILABLE', unavailableMessage: 'Admin service is temporarily unavailable.',
    });
  }

  // auth-service (Phase 9, this round). /api/auth/me now returns role +
  // account status too (auth-service's /me reads its own already-verified
  // user row — no extra call to user-service needed for this). This
  // SUPERSEDES Phase 8's rule that pointed /api/auth/me at user-service.
  if (AUTH_ROUTES.has(pathnameOnly)) {
    return proxyToService(req, res, requestId, {
      name: 'auth', baseUrl: AUTH_SERVICE_URL, breaker: authBreaker,
      targetPath: AUTH_ROUTES.get(pathnameOnly), skipAuth: true, forwardCookie: true,
      unavailableCode: 'AUTH_SERVICE_UNAVAILABLE', unavailableMessage: 'Sign-in is temporarily unavailable.',
    });
  }

  if (SUPERADMIN_ADMIN_ROUTES.has(pathnameOnly)) {
    return proxyToService(req, res, requestId, {
      name: 'admin', baseUrl: ADMIN_SERVICE_URL, breaker: adminBreaker,
      targetPath: SUPERADMIN_ADMIN_ROUTES.get(pathnameOnly), requireRole: 'SUPERADMIN',
      unavailableCode: 'ADMIN_SERVICE_UNAVAILABLE', unavailableMessage: 'Admin service is temporarily unavailable.',
    });
  }

  const notificationMatch = pathnameOnly.match(/^\/api\/superadmin\/notifications\/([^/]+)$/);
  if (notificationMatch) {
    return proxyToService(req, res, requestId, {
      name: 'admin', baseUrl: ADMIN_SERVICE_URL, breaker: adminBreaker,
      targetPath: `/notifications/${notificationMatch[1]}`, requireRole: 'SUPERADMIN',
      unavailableCode: 'ADMIN_SERVICE_UNAVAILABLE', unavailableMessage: 'Admin service is temporarily unavailable.',
    });
  }

  const sessionMatch = pathnameOnly.match(/^\/api\/superadmin\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    return proxyToService(req, res, requestId, {
      name: 'admin', baseUrl: ADMIN_SERVICE_URL, breaker: adminBreaker,
      targetPath: `/sessions/${sessionMatch[1]}`, requireRole: 'SUPERADMIN',
      unavailableCode: 'ADMIN_SERVICE_UNAVAILABLE', unavailableMessage: 'Admin service is temporarily unavailable.',
    });
  }

  const publishActionMatch = pathnameOnly.match(/^\/api\/superadmin\/publishing\/([^/]+)\/(retry|draft)$/);
  if (publishActionMatch) {
    return proxyToService(req, res, requestId, {
      name: 'admin', baseUrl: ADMIN_SERVICE_URL, breaker: adminBreaker,
      targetPath: `/publishing/${publishActionMatch[1]}/${publishActionMatch[2]}`, requireRole: 'SUPERADMIN',
      unavailableCode: 'ADMIN_SERVICE_UNAVAILABLE', unavailableMessage: 'Admin service is temporarily unavailable.',
    });
  }

  // Superadmin user-management (list/detail/suspend/reactivate/moderation
  // flag-clear) — these do NOT go directly to user-service (brief: "Do not
  // expose internal user APIs to browser directly"). They go through
  // admin-service, which proxies to user-service's internal API. Excludes
  // /api/superadmin/users/:id/reset-access on purpose — that stays an
  // auth-domain route (sends a real OTP), untouched, falling through to
  // proxyToWeb below.
  const isSuperadminUserMgmt = (pathnameOnly === '/api/superadmin/users'
      || /^\/api\/superadmin\/users\//.test(pathnameOnly))
    || /^\/api\/superadmin\/moderation\/users\//.test(pathnameOnly);
  if (isSuperadminUserMgmt) {
    return proxyToService(req, res, requestId, {
      name: 'admin-users', baseUrl: ADMIN_SERVICE_URL, breaker: adminBreaker,
      prefix: /^\/api\/superadmin/, requireRole: 'SUPERADMIN',
      unavailableCode: 'ADMIN_SERVICE_UNAVAILABLE', unavailableMessage: 'Admin service is temporarily unavailable.',
    });
  }

  if (CANVA_ROUTES.has(pathnameOnly)) {
    const { skipAuth } = CANVA_ROUTES.get(pathnameOnly);
    return proxyToService(req, res, requestId, {
      name: 'integrations-canva', baseUrl: INTEGRATIONS_SERVICE_URL, breaker: canvaBreaker,
      prefix: /^\/api/, forwardCookie: true, skipAuth,
      unavailableCode: 'INTEGRATIONS_UNAVAILABLE', unavailableMessage: 'Platform connection is temporarily unavailable.',
    });
  }

  if (LINKEDIN_ROUTES.has(pathnameOnly)) {
    const { skipAuth } = LINKEDIN_ROUTES.get(pathnameOnly);
    return proxyToService(req, res, requestId, {
      name: 'integrations-linkedin', baseUrl: INTEGRATIONS_SERVICE_URL, breaker: linkedinBreaker,
      prefix: /^\/api/, forwardCookie: true, skipAuth,
      unavailableCode: 'INTEGRATIONS_UNAVAILABLE', unavailableMessage: 'Platform connection is temporarily unavailable.',
    });
  }

  if (FACEBOOK_ROUTES.has(pathnameOnly)) {
    const { skipAuth } = FACEBOOK_ROUTES.get(pathnameOnly);
    return proxyToService(req, res, requestId, {
      name: 'integrations-facebook', baseUrl: INTEGRATIONS_SERVICE_URL, breaker: facebookBreaker,
      prefix: /^\/api/, forwardCookie: true, skipAuth,
      unavailableCode: 'INTEGRATIONS_UNAVAILABLE', unavailableMessage: 'Platform connection is temporarily unavailable.',
    });
  }

  if (INSTAGRAM_ROUTES.has(pathnameOnly)) {
    const { skipAuth } = INSTAGRAM_ROUTES.get(pathnameOnly);
    return proxyToService(req, res, requestId, {
      name: 'integrations-instagram', baseUrl: INTEGRATIONS_SERVICE_URL, breaker: instagramBreaker,
      prefix: /^\/api/, forwardCookie: true, skipAuth,
      unavailableCode: 'INTEGRATIONS_UNAVAILABLE', unavailableMessage: 'Platform connection is temporarily unavailable.',
    });
  }

  if (WHATSAPP_ROUTES.has(pathnameOnly)) {
    const { skipAuth, targetPath } = WHATSAPP_ROUTES.get(pathnameOnly);
    return proxyToService(req, res, requestId, {
      name: 'integrations-whatsapp', baseUrl: INTEGRATIONS_SERVICE_URL, breaker: whatsappBreaker,
      prefix: /^\/api/, targetPath, forwardCookie: true, skipAuth,
      unavailableCode: 'INTEGRATIONS_UNAVAILABLE', unavailableMessage: 'Platform connection is temporarily unavailable.',
    });
  }

  const whatsappGroupMatch = pathnameOnly.match(/^\/api\/whatsapp\/groups\/(.+)$/);
  if (whatsappGroupMatch) {
    return proxyToService(req, res, requestId, {
      name: 'integrations-whatsapp', baseUrl: INTEGRATIONS_SERVICE_URL, breaker: whatsappBreaker,
      targetPath: `/whatsapp/groups/${whatsappGroupMatch[1]}`, forwardCookie: true,
      unavailableCode: 'INTEGRATIONS_UNAVAILABLE', unavailableMessage: 'Platform connection is temporarily unavailable.',
    });
  }

  // media-service (Phase 4, this round). Prefix match, not an exact-path
  // Map, because /api/media-assets/:id carries a dynamic id segment.
  // scheduler-service (Phase 6, this round). /api/scheduler/check is
  // Superadmin/cron "run now" — same access level as the original
  // (requireApiSuperadmin fallback when no internal actor header exists).
  // /api/scheduler itself (GET/POST/PATCH/DELETE) is any signed-in user,
  // scoped server-side by x-actor-user-id exactly like every CRUD route
  // this migration has built.
  if (pathnameOnly === '/api/scheduler/check') {
    return proxyToService(req, res, requestId, {
      name: 'scheduler', baseUrl: SCHEDULER_SERVICE_URL, breaker: schedulerBreaker,
      prefix: /^\/api/, requireRole: 'SUPERADMIN', forwardCookie: false,
      unavailableCode: 'SCHEDULER_UNAVAILABLE', unavailableMessage: 'Scheduler is temporarily unavailable.',
    });
  }
  if (req.url.startsWith('/api/scheduler')) {
    return proxyToService(req, res, requestId, {
      name: 'scheduler', baseUrl: SCHEDULER_SERVICE_URL, breaker: schedulerBreaker,
      prefix: /^\/api/, forwardCookie: false,
      unavailableCode: 'SCHEDULER_UNAVAILABLE', unavailableMessage: 'Scheduler is temporarily unavailable.',
    });
  }

  if (AI_ROUTES.has(pathnameOnly)) {
    // Only /content needs the long budget. /image, /vary-image and /alt-text
    // either return 202 immediately or are short calls, so they keep the
    // standard 15s bound and a hung one is still cut off quickly.
    const isSynchronousLlmCall = pathnameOnly === '/api/generate-content';
    return proxyToService(req, res, requestId, {
      name: 'ai', baseUrl: AI_SERVICE_URL, breaker: aiBreaker,
      targetPath: AI_ROUTES.get(pathnameOnly), forwardCookie: false,
      unavailableCode: 'AI_SERVICE_UNAVAILABLE', unavailableMessage: 'AI generation is temporarily unavailable.',
      timeoutMs: isSynchronousLlmCall ? AI_LONG_TIMEOUT_MS : undefined,
    });
  }

  if (PUBLISH_ROUTES.has(pathnameOnly)) {
    return proxyToService(req, res, requestId, {
      name: 'publishing', baseUrl: PUBLISHING_SERVICE_URL, breaker: publishingBreaker,
      targetPath: PUBLISH_ROUTES.get(pathnameOnly), forwardCookie: false,
      unavailableCode: 'PUBLISHING_UNAVAILABLE', unavailableMessage: 'Publishing is temporarily unavailable.',
      timeoutMs: PUBLISH_TIMEOUT_MS,
    });
  }

  const stagedPublishMediaMatch = pathnameOnly.match(/^\/api\/(instagram|whapi)\/media\/([^/]+)$/);
  if (stagedPublishMediaMatch) {
    return proxyToService(req, res, requestId, {
      name: 'publishing-media', baseUrl: PUBLISHING_SERVICE_URL, breaker: publishingBreaker,
      targetPath: `/${stagedPublishMediaMatch[1]}/media/${stagedPublishMediaMatch[2]}`, skipAuth: true, forwardCookie: false,
      unavailableCode: 'PUBLISHING_UNAVAILABLE', unavailableMessage: 'Publishing media is temporarily unavailable.',
    });
  }

  if (req.url.startsWith('/api/media-assets')) {
    return proxyToService(req, res, requestId, {
      name: 'media', baseUrl: MEDIA_SERVICE_URL, breaker: mediaBreaker,
      prefix: /^\/api/, forwardCookie: false,
      unavailableCode: 'MEDIA_UNAVAILABLE', unavailableMessage: 'Media service is temporarily unavailable.',
    });
  }

  // GET /api/moderation/incidents/:id — a signed-in user's OWN warning
  // detail. Forwards to user-service's actor-scoped /self route, never the
  // admin-only /internal/moderation/incidents/:id (no ownership check).
  const myIncidentMatch = pathnameOnly.match(/^\/api\/moderation\/incidents\/([^/]+)$/);
  if (myIncidentMatch && req.method === 'GET') {
    return proxyToService(req, res, requestId, {
      name: 'user', baseUrl: USER_SERVICE_URL, breaker: userBreaker,
      targetPath: `/moderation/incidents/${myIncidentMatch[1]}/self`, forwardCookie: false,
      unavailableCode: 'USER_SERVICE_UNAVAILABLE', unavailableMessage: 'Moderation service is temporarily unavailable.',
    });
  }

  if (pathnameOnly === '/api/editor-draft') {
    return proxyToService(req, res, requestId, {
      name: 'user', baseUrl: USER_SERVICE_URL, breaker: userBreaker,
      targetPath: '/editor-draft', forwardCookie: false,
      unavailableCode: 'USER_SERVICE_UNAVAILABLE', unavailableMessage: 'Draft storage is temporarily unavailable.',
    });
  }

  if (pathnameOnly === '/api/ffmpeg/logo') {
    return proxyToService(req, res, requestId, {
      name: 'media', baseUrl: MEDIA_SERVICE_URL, breaker: mediaBreaker,
      targetPath: '/branded-video', forwardCookie: false,
      unavailableCode: 'MEDIA_UNAVAILABLE', unavailableMessage: 'Media service is temporarily unavailable.',
    });
  }

  if (req.url.startsWith('/api/integrations/')) {
    // Any signed-in user (not Superadmin-only) — same access level as the
    // existing /api/<provider>/status routes this proxies to.
    return proxyToService(req, res, requestId, {
      name: 'integrations', baseUrl: INTEGRATIONS_SERVICE_URL, breaker: integrationsBreaker,
      prefix: /^\/api\/integrations/, forwardCookie: true,
      unavailableCode: 'INTEGRATIONS_UNAVAILABLE', unavailableMessage: 'Platform connection is temporarily unavailable.',
    });
  }

  return proxyToWeb(req, res, requestId);
});

server.listen(PORT, () => log.info({ event: 'listening', port: PORT }));

function shutdown(signal) {
  log.info({ event: 'shutdown_start', signal });
  server.close(() => { log.info({ event: 'shutdown_complete' }); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
// Safety net found necessary by a real crash during testing elsewhere in
// this migration (publishing-service): an uncaught async error anywhere
// in a request handler is a Node process-level unhandledRejection by
// default, which CRASHES the whole service — taking down every other
// in-flight request too, not just the one that errored. Log and survive.
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
