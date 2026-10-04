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
//   disconnect (A, but a no-op) -> PORTED (this file, same no-op)
//   media/[id] (C, media staging) -> NOT touched, media-service's domain later
//   publish    (B, publishing)  -> NOT touched, publishing-service's domain later

import { createFacebookVault } from '../facebook/vault.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

export function createInstagramRouter(pool) {
  const facebookVault = createFacebookVault(pool);

  return async function handleInstagramRoute(pathname, req, res) {
    // --- GET /status ---
    if (pathname === '/status' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });

      const found = await facebookVault.getFacebookAuth(userId);
      if (!found) return json(res, 200, { connected: false });
      const resolved = { userId: found.providerUserId };

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

    // --- POST /disconnect — a no-op by design, matching the original:
    // Instagram has no credentials of its own to revoke; it just stops
    // being selected as a publish target. The Facebook connection (and the
    // underlying Meta link) is untouched. ---
    if (pathname === '/disconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, { success: true });
    }

    return null;
  };
}
