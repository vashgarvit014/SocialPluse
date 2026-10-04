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

import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWhatsAppService } from './service.mjs';
import { createConnectionsStore } from './connections.mjs';
import { maskPhone, whapiFetch, whapiError } from './whapi-client.mjs';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';
const LOG_FILE = join(process.cwd(), 'whatsapp-events.log');
const GATE_BASE = process.env.WHAPI_API_BASE || 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_API_TOKEN || '';
const CHAT_PAGE = 500;
const CHAT_MAX = 2000;
const GROUP_PAGE = 100;
const GROUP_MAX = 2000;
const SUBGROUP_CONCURRENCY = 4;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function requireActor(req) {
  const userId = req.headers['x-actor-user-id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
function serviceError(res, error, fallback) {
  return json(res, error?.status || 502, {
    success: false,
    code: error?.code || 'WHATSAPP_REQUEST_FAILED',
    message: error instanceof Error && error.message ? error.message : fallback,
  });
}
function normalizeBase(url) {
  const clean = url.trim().replace(/\/+$/, '');
  return clean.startsWith('http') ? clean : `https://${clean}`;
}
function whapiConfig() {
  if (!WHAPI_TOKEN.trim()) return null;
  return { token: WHAPI_TOKEN.trim(), baseUrl: normalizeBase(GATE_BASE) };
}
async function requireChannelOwner(req, connections, res) {
  const userId = requireActor(req);
  if (!userId) {
    json(res, 401, { error: 'Unauthorized' });
    return null;
  }
  const config = whapiConfig();
  if (!config) {
    json(res, 401, { success: false, connected: false, code: 'WHAPI_NOT_CONFIGURED', reason: 'NOT_CONFIGURED', message: 'Whapi is not configured. Add WHAPI_API_TOKEN to integrations-service env.' });
    return null;
  }
  const owner = await connections.getConnectedOwnerByToken(config.token);
  if (!owner) {
    json(res, 403, { success: false, connected: false, code: 'WHATSAPP_CHANNEL_UNCLAIMED', reason: 'WHATSAPP_CHANNEL_UNCLAIMED', message: 'No WhatsApp account is connected to this workspace yet. Connect WhatsApp first.' });
    return null;
  }
  if (owner.user_id !== userId) {
    json(res, 403, { success: false, connected: false, code: 'WHATSAPP_NOT_CHANNEL_OWNER', reason: 'WHATSAPP_NOT_CHANNEL_OWNER', message: 'This WhatsApp number is connected to a different SocialPulse account.' });
    return null;
  }
  return config;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function getWhapiJson(path, config, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await whapiFetch(path, config.token, { method: 'GET' }, config.baseUrl);
      if (res.status === 429 || res.status >= 500) {
        if (i < attempts - 1) { await sleep(700 * Math.pow(2, i)); continue; }
        return { ok: false, status: res.status, body: await res.text().catch(() => ''), data: null };
      }
      if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => ''), data: null };
      return { ok: true, status: res.status, body: '', data: await res.json().catch(() => null) };
    } catch {
      if (i < attempts - 1) { await sleep(500 * Math.pow(2, i)); continue; }
      return { ok: false, status: 0, body: '', data: null };
    }
  }
  return { ok: false, status: 0, body: '', data: null };
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
function label(row, fallback) {
  return String(row?.name || row?.pushname || row?.title || '').trim() || fallback;
}
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
function verifySignature(rawBody, header) {
  if (!APP_SECRET) return true;
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
  return safeEqual(expected, header);
}
function extractEvent(payload) {
  const out = { authenticated: false };
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const user = value.user || {};
      const phone = value.phone_number || user.phone;
      if (phone) {
        out.authenticated = true;
        out.phone = phone;
        out.accountName = user.pushname || user.name;
      }
      const channelId = value.channel_id || value.phone_number;
      if (channelId && !out.channelId) out.channelId = channelId;
      const sessionId = value.session_id || value.login_session;
      if (sessionId && !out.sessionId) out.sessionId = sessionId;
    }
  }
  return out;
}

export function createWhatsAppRouter(pool) {
  const service = createWhatsAppService(pool);
  const connections = createConnectionsStore(pool);

  return async function handleWhatsAppRoute(pathname, req, res) {
    const url = new URL(req.url, 'http://internal');

    if (pathname === '/webhook' && req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token && VERIFY_TOKEN && safeEqual(token, VERIFY_TOKEN)) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(challenge || '');
        return;
      }
      return json(res, 403, { error: 'verification_failed' });
    }

    if (pathname === '/webhook' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return json(res, 400, { received: false });
      }
      if (!verifySignature(rawBody, req.headers['x-hub-signature-256'])) {
        return json(res, 403, { received: false, error: 'invalid_signature' });
      }
      try {
        appendFileSync(LOG_FILE, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`);
      } catch (err) {
        console.error('[integrations-service] whatsapp webhook log failed:', err instanceof Error ? err.message : err);
      }
      const event = extractEvent(payload);
      if (event.authenticated) {
        const match = await connections.resolveByProviderRef({ channelId: event.channelId, sessionId: event.sessionId });
        if (!match) return json(res, 200, { received: true, matched: false });
        const result = await connections.confirmConnection(match.user_id, match.provider_session_id || '', {
          phoneMasked: event.phone ? maskPhone(event.phone) : null,
          accountName: event.accountName || null,
          channelId: event.channelId || null,
        });
        return json(res, 200, { received: true, matched: true, connected: !!result.ok });
      }
      return json(res, 200, { received: true });
    }

    if (pathname === '/status/whapi' && req.method === 'GET') {
      const config = await requireChannelOwner(req, connections, res);
      if (!config) return;
      try {
        const provider = await whapiFetch('/health', config.token, { method: 'GET' }, config.baseUrl);
        if (!provider.ok) {
          const body = await provider.text().catch(() => '');
          const mapped = whapiError(provider.status, body, 'health check');
          if (provider.status === 401) return json(res, 200, { connected: false, reason: 'UNAUTHORIZED', message: mapped.message, code: mapped.code });
          return json(res, 200, { connected: false, reason: 'NOT_CONNECTED', message: mapped.message, code: mapped.code, status: provider.status });
        }
        const data = await provider.json().catch(() => ({}));
        const isConnected = !!data.user?.id || !!data.user?.phone;
        if (!isConnected) {
          return json(res, 200, { connected: false, reason: 'NOT_CONNECTED', channelStatus: data.status?.text || 'UNKNOWN', message: `Whapi channel status: ${data.status?.text || 'UNKNOWN'}` });
        }
        const rawPhone = data.user?.phone || '';
        return json(res, 200, {
          connected: true,
          channelStatus: data.status?.text || 'UNKNOWN',
          phoneNumberMasked: rawPhone ? maskPhone(rawPhone) : undefined,
          phoneNumber: rawPhone || undefined,
          accountName: data.user?.pushname || data.user?.name || '',
          channelId: data.channel_id || undefined,
          uptime: typeof data.uptime === 'number' ? data.uptime : undefined,
        });
      } catch (error) {
        console.error('[integrations-service] whapi/status error:', error instanceof Error ? error.message : error);
        return json(res, 200, { connected: false, reason: 'NETWORK_ERROR', message: 'Network error checking Whapi status.' });
      }
    }

    if (pathname === '/whapi/groups' && req.method === 'GET') {
      const config = await requireChannelOwner(req, connections, res);
      if (!config) return;
      const count = Math.min(500, Math.max(1, Number(url.searchParams.get('count')) || 100));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      try {
        const provider = await whapiFetch(`/groups?count=${count}&offset=${offset}`, config.token, { method: 'GET' }, config.baseUrl);
        if (!provider.ok) {
          const body = await provider.text().catch(() => '');
          const mapped = whapiError(provider.status, body, 'fetching groups');
          return json(res, provider.status === 401 ? 401 : 502, { success: false, code: provider.status === 401 ? 'WHAPI_UNAUTHORIZED' : 'WHAPI_GROUPS_FETCH_FAILED', message: mapped.message });
        }
        const data = await provider.json().catch(() => ({}));
        const rawGroups = Array.isArray(data.groups) ? data.groups : [];
        const normalized = rawGroups
          .filter((g) => g && typeof g.id === 'string' && g.id.length > 0)
          .filter((g) => {
            const t = String(g.type || 'group').toLowerCase();
            return t === 'group' || t === 'announcement' || t === 'unknown' || !g.type;
          })
          .map((g) => {
            let type = 'group';
            if (g.isCommunityAnnounce) type = 'announcement_group';
            else if (g.is_parent) type = 'community';
            return {
              id: String(g.id),
              name: String(g.name || 'Unnamed Group'),
              participantsCount: typeof g.participants_count === 'number' ? g.participants_count : typeof g.participantsCount === 'number' ? g.participantsCount : Array.isArray(g.participants) ? g.participants.length : 0,
              type,
              isParent: !!g.is_parent,
              isCommunityAnnounce: !!g.isCommunityAnnounce,
              linkedParent: g.linkedParent || undefined,
            };
          });
        return json(res, 200, {
          success: true,
          groups: normalized.map((g) => ({
            id: g.id, name: g.name, participantsCount: g.participantsCount, type: g.type,
            ...(g.type !== 'group' ? { isParent: g.isParent, isCommunityAnnounce: g.isCommunityAnnounce, linkedParent: g.linkedParent } : {}),
          })),
          count: normalized.length,
          total: typeof data.total === 'number' ? data.total : normalized.length,
          offset,
        });
      } catch (error) {
        console.error('[integrations-service] whapi/groups error:', error instanceof Error ? error.message : error);
        return json(res, 502, { success: false, code: 'WHAPI_GROUPS_FETCH_FAILED', message: 'Network error fetching Whapi groups.' });
      }
    }

    if (pathname === '/whapi/destinations' && req.method === 'GET') {
      const config = await requireChannelOwner(req, connections, res);
      if (!config) return;
      try {
        const loadGroups = async () => {
          const rows = [];
          for (let offset = 0; offset < GROUP_MAX; offset += GROUP_PAGE) {
            const page = await getWhapiJson(`/groups?count=${GROUP_PAGE}&offset=${offset}`, config);
            const got = page.data?.groups;
            if (!page.ok || !Array.isArray(got) || got.length === 0) break;
            rows.push(...got);
            if (got.length < GROUP_PAGE) break;
          }
          return rows;
        };
        const loadChats = async () => {
          const rows = [];
          let total = 0;
          for (let offset = 0; offset < CHAT_MAX; offset += CHAT_PAGE) {
            const page = await getWhapiJson(`/chats?count=${CHAT_PAGE}&offset=${offset}`, config);
            const got = page.data?.chats;
            if (!page.ok || !Array.isArray(got) || got.length === 0) break;
            rows.push(...got);
            total = typeof page.data?.total === 'number' ? page.data.total : rows.length;
            if (got.length < CHAT_PAGE) break;
          }
          return { rows, total };
        };
        const groupsPromise = loadGroups();
        const communitiesPromise = getWhapiJson('/communities', config);
        const chatsPromise = loadChats();
        const commRes = await communitiesPromise;
        const communities = Array.isArray(commRes.data?.communities) ? commRes.data.communities.slice(0, 100) : [];
        await mapLimit(communities, SUBGROUP_CONCURRENCY, async (community) => {
          if (!community.id) return;
          const sub = await getWhapiJson(`/communities/${encodeURIComponent(String(community.id))}/subgroups`, config, 2);
          const info = sub.data?.announceGroupInfo;
          if (info?.id) {
            community.announcementGroupId = String(info.id);
            community.announcementGroupName = info?.title ? String(info.title) : '';
          }
        });
        const [groupRows, chats] = await Promise.all([groupsPromise, chatsPromise]);
        const byId = new Map();
        for (const group of groupRows) {
          if (!group.id || group.is_parent) continue;
          const id = String(group.id);
          byId.set(id, {
            id,
            name: label(group, 'Unnamed Group'),
            type: group.isCommunityAnnounce ? 'community' : 'group',
            participantsCount: group.participants_count ?? group.participantsCount ?? 0,
            sendId: id,
          });
        }
        for (const community of communities) {
          if (!community.id || !community.announcementGroupId) continue;
          const id = String(community.id);
          const sendId = String(community.announcementGroupId);
          const existing = byId.get(sendId);
          byId.set(id, {
            id,
            name: community.announcementGroupName ? String(community.announcementGroupName) : label(community, existing?.name ?? 'WhatsApp Community'),
            type: 'community',
            participantsCount: community.participants_count ?? community.participantsCount ?? 0,
            sendId,
          });
          if (sendId !== id) byId.delete(sendId);
        }
        for (const chat of chats.rows) {
          if (!chat.id) continue;
          const id = String(chat.id);
          if (byId.has(id)) continue;
          if (String(chat.type || 'contact').toLowerCase() === 'group') continue;
          byId.set(id, {
            id,
            name: label(chat, id.replace(/@(s\.whatsapp\.net|lid|g\.us)$/, '')),
            type: 'chat',
            participantsCount: 0,
            sendId: id,
          });
        }
        const destinations = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
        return json(res, 200, {
          success: true,
          destinations,
          counts: {
            community: destinations.filter((d) => d.type === 'community').length,
            group: destinations.filter((d) => d.type === 'group').length,
            chat: destinations.filter((d) => d.type === 'chat').length,
            total: destinations.length,
            chatsTotalAtProvider: chats.total,
          },
        });
      } catch (error) {
        console.error('[integrations-service] whapi/destinations error:', error instanceof Error ? error.message : error);
        return json(res, 502, { success: false, code: 'WHAPI_DESTINATIONS_FAILED', message: 'Network error loading WhatsApp destinations.' });
      }
    }

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

    const groupsMatch = pathname.match(/^\/groups(?:\/([^/]+)(?:\/([^/]+))?)?$/);
    if (groupsMatch) {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const groupId = groupsMatch[1] ? decodeURIComponent(groupsMatch[1]) : null;
      const child = groupsMatch[2] || null;
      try {
        if (!groupId && req.method === 'GET') {
          return json(res, 200, await service.listOfficialGroups({ limit: url.searchParams.get('limit') || '25', after: url.searchParams.get('after') || undefined }));
        }
        if (!groupId && req.method === 'POST') {
          const body = await readJson(req);
          if (body === undefined) return json(res, 400, { success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' });
          return json(res, 200, await service.createOfficialGroup(body));
        }
        if (groupId && !child && req.method === 'GET') return json(res, 200, await service.getOfficialGroup(groupId));
        if (groupId && !child && req.method === 'POST') {
          const body = await readJson(req);
          if (body === undefined) return json(res, 400, { success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' });
          return json(res, 200, await service.updateOfficialGroup(groupId, body));
        }
        if (groupId && !child && req.method === 'DELETE') return json(res, 200, await service.deleteOfficialGroup(groupId));
        if (groupId && child === 'invite-link' && req.method === 'GET') return json(res, 200, await service.getOfficialInviteLink(groupId));
        if (groupId && child === 'invite-link' && req.method === 'POST') return json(res, 200, await service.resetOfficialInviteLink(groupId));
        if (groupId && child === 'message' && req.method === 'POST') {
          const body = await readJson(req);
          if (body === undefined) return json(res, 400, { success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' });
          return json(res, 200, await service.sendOfficialGroupMessage(groupId, body));
        }
        if (groupId && child === 'participants' && req.method === 'DELETE') {
          const body = await readJson(req);
          if (body === undefined) return json(res, 400, { success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' });
          return json(res, 200, await service.removeOfficialParticipants(groupId, body));
        }
      } catch (error) {
        console.error('[integrations-service] whatsapp/groups error:', error instanceof Error ? error.message : error);
        return serviceError(res, error, 'WhatsApp group request failed.');
      }
    }

    if (pathname === '/send-message' && req.method === 'POST') {
      const userId = requireActor(req);
      if (!userId) return json(res, 401, { error: 'Unauthorized' });
      const body = await readJson(req);
      if (body === undefined) return json(res, 400, { success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' });
      try {
        return json(res, 200, await service.sendOfficialMessage(body));
      } catch (error) {
        console.error('[integrations-service] whatsapp/send-message error:', error instanceof Error ? error.message : error);
        return serviceError(res, error, 'Network error sending the message.');
      }
    }

    return null;
  };
}
