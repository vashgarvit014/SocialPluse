// Instagram has NO independent OAuth here — confirmed by reading every file
// under src/app/api/instagram/ before writing a line of this. auth/callback
// in the monolith are both thin redirects into /api/facebook/auth (status:
// A/E below, not real logic); callback is literally dead (kept only so an
// old bookmark doesn't 404 — Instagram no longer has its own registered
// redirect URI anywhere). Status and disconnect are the only real logic,
// and both just read/report on the Facebook connection's linked Page data.
// There is nothing OAuth-shaped to extract — only status.
//
// Route map (classified per the audit this round):
//   auth       (A, but trivial) -> not ported; see note below
//   callback   (E, dead code)   -> not ported
//   status     (A, real logic)  -> PORTED (this file)
//   disconnect (A, no-op in the monolith) -> NOW REAL (this file): sets the
//     user's Instagram opt-out (facebook.meta.instagramDisabled) and tells
//     scheduler-service to mark every future scheduled Instagram row
//     CONNECTION_REQUIRED. Instagram has no token of its own to revoke — the
//     Facebook Page token underneath stays because Facebook still needs it —
//     but "disconnected" must be authoritative for publishing, otherwise a
//     scheduled post would still go out after the user pressed Disconnect.
//   reconnect  (new)            -> clears the opt-out and re-arms the rows
//     that were marked CONNECTION_REQUIRED, so "Retry failed" can run.
//   media/[id] (C, media staging) -> NOT touched, media-service's domain later
//   publish    (B, publishing)  -> NOT touched, publishing-service's domain later

import { createFacebookVault } from '../facebook/vault.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';
const SCHEDULER_SERVICE_URL = process.env.SCHEDULER_SERVICE_URL || 'http://scheduler-service:4007';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// Bridge to scheduler-service, which owns scheduled_posts /
// scheduled_post_platforms — the same "don't reach into another service's
// table" rule the LinkedIn/Facebook disconnect bridges already follow.
async function bridge(body, requestId) {
  try {
    const res = await fetch(`${SCHEDULER_SERVICE_URL}/internal/platform-connectivity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'x-request-id': requestId || '' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return typeof data.affected === 'number' ? data.affected : 0;
  } catch {
    return 0; // best-effort, same as the other disconnect bridges
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

export function createInstagramRouter(pool, deps = {}) {
  const facebookVault = createFacebookVault(pool);
  const log = deps.log || { info() {}, warn() {}, error() {} };

  return async function handleInstagramRoute(pathname, req, res, opts = {}) {
    const requestId = opts.requestId || '';
    // --- GET /status ---
    if (pathname === '/status' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });

      const found = await facebookVault.getFacebookAuth(userId);
      if (!found) return json(res, 200, { connected: false });
      const resolved = { userId: found.providerUserId };

      const disabled = await facebookVault.getInstagramDisabled(userId);
      if (disabled === true) {
        return json(res, 200, { connected: false, reason: 'DISCONNECTED_BY_USER' });
      }
      const ig = await facebookVault.getInstagramAccount(userId);
      if (!ig) return json(res, 200, { connected: false, reason: 'NO_LINKED_INSTAGRAM_ACCOUNT' });

      try {
        const r = await fetch(`${GRAPH}/${ig.igUserId}?fields=username&access_token=${encodeURIComponent(ig.token)}`);
        if (!r.ok) return json(res, 200, { connected: false });
        const data = await r.json();
        return json(res, 200, {
          connected: true, userId: resolved.userId, igUserId: ig.igUserId,
          username: data.username || ig.username || '', pageId: ig.pageId, pageName: ig.pageName,
        });
      } catch {
        return json(res, 200, { connected: false });
      }
    }

    // --- POST /disconnect — real now (was a no-op in the monolith).
    // Persists the opt-out, then tells scheduler-service to mark every
    // FUTURE scheduled Instagram row CONNECTION_REQUIRED immediately so the
    // warning shows in the Scheduler before the due time instead of only
    // after the worker discovers it. Existing published history is untouched.
    if (pathname === '/disconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const ok = await facebookVault.setInstagramDisabled(userId, true);
      if (!ok) return json(res, 409, { success: false, code: 'NOT_CONNECTED', message: 'Instagram is not connected.' });
      const marked = await bridge({ userId, platform: 'instagram', action: 'disconnect' }, requestId);
      log.info({ event: 'PLATFORM_DISCONNECTED', userId, platform: 'instagram', futureRowsMarked: marked });
      return json(res, 200, { success: true, connected: false, futureScheduledMarked: marked });
    }

    // --- POST /reconnect — clears the opt-out and re-arms the rows that the
    // disconnect marked CONNECTION_REQUIRED, so the user can then hit
    // "Retry failed". Only touches this user's own rows.
    if (pathname === '/reconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const changed = await facebookVault.setInstagramDisabled(userId, false);
      if (!changed) return json(res, 409, { success: false, code: 'NOT_CONNECTED', message: 'Connect Facebook with a linked Instagram account first.' });
      const released = await bridge({ userId, platform: 'instagram', action: 'reconnect' }, requestId);
      log.info({ event: 'PLATFORM_RECONNECTED', userId, platform: 'instagram', rowsReleased: released });
      return json(res, 200, { success: true, rowsReleased: released });
    }

    return null;
  };
}
