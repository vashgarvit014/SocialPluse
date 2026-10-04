// Connection-lifecycle routes only (connect/status/cancel/disconnect/
// communities) — faithful port of src/app/api/whatsapp/{connect,status,
// cancel,disconnect,communities}/route.ts, backed by service.mjs.
//
// Deliberately NOT ported this round (scope decision, documented in
// MIGRATION-NOTES.md):
//   /api/whapi/groups, /api/whapi/destinations — already safely proxied to
//     the monolith since Phase 3A (read-only, tested, graceful 503 on
//     failure already). Re-porting destinations' ~280 lines of pagination/
//     caching/merge logic duplicates real complexity for no fault-isolation
//     gain over what the existing proxy already provides.
//   /api/whapi/webhook, /api/whatsapp/webhook — passive event loggers, not
//     connection-state correlation (verified by reading both before this
//     decision, not assumed).
//   /api/whatsapp/publish, /api/whapi/publish — publishing, stays in the
//     monolith until publishing-service exists, as instructed.
//   /api/whapi/media/[id] — media staging (.whapi-media), publish-dependent,
//     untouched.

import { createWhatsAppService } from './service.mjs';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

export function createWhatsAppRouter(pool) {
  const service = createWhatsAppService(pool);

  return async function handleWhatsAppRoute(pathname, req, res) {
    const url = new URL(req.url, 'http://internal');

    // --- POST /connect — starts/restarts a QR attempt. Never returns
    // CONNECTED on its own; see createWhatsAppConnectionSession's own
    // idempotency guard (probes before minting a new QR). ---
    if (pathname === '/connect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        const result = await service.createWhatsAppConnectionSession(userId);
        return json(res, 200, result);
      } catch (error) {
        console.error('[integrations-service] whatsapp/connect error:', error instanceof Error ? error.message : error);
        return json(res, 502, { status: 'ERROR', message: 'WhatsApp connection could not be started.' });
      }
    }

    // --- GET /status — ?poll=1 runs the exact-session confirmation (the
    // ONLY thing that can promote WAITING_FOR_SCAN to CONNECTED). ---
    if (pathname === '/status' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const diagnostics = url.searchParams.get('diagnostics') === '1';
      const poll = url.searchParams.get('poll') === '1';
      try {
        if (poll) {
          const result = await service.pollWhatsAppConnection(userId);
          return json(res, 200, result);
        }
        return json(res, 200, await service.getWhatsAppStatus(userId, diagnostics));
      } catch (error) {
        console.error('[integrations-service] whatsapp/status error:', error instanceof Error ? error.message : error);
        return json(res, 502, {
          status: 'ERROR', connected: false, currentUserConnected: false, channelAuthenticated: false,
          providerAvailable: false, canStartConnect: false, message: 'WhatsApp connection status could not be read.',
        });
      }
    }

    // --- POST /cancel — abandons a pending QR (CANCELLED, not deletable
    // by a late scan/webhook). ---
    if (pathname === '/cancel' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        await service.cancelPendingQr(userId);
        return json(res, 200, { success: true, status: 'CANCELLED' });
      } catch {
        return json(res, 500, { success: false, message: 'Could not cancel the pending QR.' });
      }
    }

    // --- POST /disconnect — local record cleared unconditionally; provider
    // logout best-effort (reported, not thrown on failure). ---
    if (pathname === '/disconnect' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        const outcome = await service.disconnectWhatsApp(userId);
        return json(res, 200, { success: true, ...outcome });
      } catch (error) {
        return json(res, 502, { success: false, message: error instanceof Error ? error.message : 'WhatsApp could not be disconnected.' });
      }
    }

    // --- GET /communities ---
    if (pathname === '/communities' && req.method === 'GET') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      try {
        const communities = await service.getWhatsAppCommunities(userId);
        return json(res, 200, { success: true, communities });
      } catch (error) {
        return json(res, 502, { success: false, message: error instanceof Error ? error.message : 'WhatsApp communities could not be loaded.' });
      }
    }

    return null;
  };
}
