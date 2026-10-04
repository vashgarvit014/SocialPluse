// Faithful port of src/lib/whatsapp-service.ts, MINUS publishWhatsAppMessage
// (publishing stays in the monolith — see MIGRATION-NOTES.md). Everything
// else — status, QR pairing, polling/confirmation, disconnect, cancel,
// communities listing — is the real logic, not a reimplementation from
// scratch. Partner/multi-channel mode is preserved exactly as it exists in
// the original (conditionally used if WHATSAPP_PARTNER_API_KEY is set) but
// NOT required — this deployment runs shared-channel mode, same as today.

import QRCode from 'qrcode';
import { whapiFetch, whapiError, maskPhone } from './whapi-client.mjs';
import { createConnectionsStore, toSummary, fingerprintQr } from './connections.mjs';

const GATE_BASE = process.env.WHAPI_API_BASE || 'https://gate.whapi.cloud';
const MANAGER_BASE = process.env.WHATSAPP_PARTNER_API_BASE || 'https://manager.whapi.cloud';
const GRAPH = 'https://graph.facebook.com/v21.0';
const INFO_FIELDS = 'subject,description,participants,join_approval_mode,suspended,creation_timestamp,total_participant_count';

function normalizeBase(url) {
  const clean = url.trim().replace(/\/+$/, '');
  return clean.startsWith('http') ? clean : `https://${clean}`;
}

function existingChannelConfig() {
  const token = process.env.WHAPI_API_TOKEN?.trim();
  if (!token) return null;
  return { baseUrl: normalizeBase(GATE_BASE), token, channelId: process.env.WHAPI_CHANNEL_ID?.trim() || undefined };
}

function partnerConfig() {
  const token = process.env.WHATSAPP_PARTNER_API_KEY?.trim();
  const projectId = process.env.WHATSAPP_PARTNER_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  return { token, projectId, baseUrl: normalizeBase(MANAGER_BASE) };
}

async function partnerFetch(config, path, init) {
  const url = `${config.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  return fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, ...(init?.headers || {}) } });
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return 'another account';
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : '';
  return `${head}${'*'.repeat(Math.max(2, local.length - 2))}${tail}@${domain}`;
}

function clientMessage() {
  return 'WhatsApp connection could not be completed. Please try connecting again.';
}

function officialConfig() {
  if (process.env.WHATSAPP_ENABLED === 'false') return null;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

function whatsAppError(status, body, context) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || '';
    if (parsed?.error?.type === 'OAuthException' || status === 401) {
      return { code: 'WHATSAPP_AUTH_EXPIRED', message: `WhatsApp authentication expired during ${context}. Regenerate the access token.` };
    }
  } catch { /* fall through to status mapping */ }
  if (status === 403) {
    return { code: 'WHATSAPP_PERMISSION_DENIED', message: `WhatsApp denied permission during ${context} (403). Check the token's permissions and the number's Official Business Account status.` };
  }
  if (status === 429) {
    return { code: 'WHATSAPP_RATE_LIMIT', message: 'WhatsApp rate limit reached (429). Please wait and try again.' };
  }
  const suffix = detail ? ` ${detail.slice(0, 250)}` : '';
  return { code: 'WHATSAPP_REQUEST_FAILED', message: `WhatsApp request failed during ${context} (${status}).${suffix}` };
}

async function waFetch(path, accessToken, init) {
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
}

function requireOfficialConfig() {
  const config = officialConfig();
  if (!config) {
    const err = new Error('WhatsApp is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to integrations-service env.');
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    err.status = 401;
    throw err;
  }
  return config;
}

async function graphJson(res, context) {
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const mapped = whatsAppError(res.status, raw, context);
    mapped.status = res.status === 429 ? 429 : 502;
    mapped.rawBody = raw;
    throw Object.assign(new Error(mapped.message), mapped);
  }
  return res.json().catch(() => ({}));
}

export function createWhatsAppService(pool) {
  const connections = createConnectionsStore(pool);

  async function getActiveChannel(userId) {
    const connected = await connections.getConnectedChannel(userId);
    if (connected) return { baseUrl: normalizeBase(GATE_BASE), token: connected.token, channelId: connected.channelId };
    return null;
  }

  async function getPendingChannel(userId) {
    const row = await connections.getConnectionByUser(userId);
    if (!row?.channel_token) return null;
    return { baseUrl: normalizeBase(GATE_BASE), token: row.channel_token, channelId: row.provider_channel_id || undefined };
  }

  async function probeChannel(channel) {
    try {
      const res = await whapiFetch('/health', channel.token, { method: 'GET' }, channel.baseUrl);
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        const mapped = whapiError(res.status, raw, 'connection verification');
        console.error('[whatsapp/service] status verification failed:', mapped.code, mapped.message);
        return { ok: false, authenticated: false, providerStatus: 'UNKNOWN', needsRelogin: res.status === 401, error: clientMessage() };
      }
      const data = await res.json().catch(() => ({}));
      const providerStatus = data.status?.text || 'UNKNOWN';
      const authenticated = !!data.user?.id || !!data.user?.phone;
      return {
        ok: true, authenticated, phone: data.user?.phone,
        accountId: data.user?.id != null ? String(data.user.id) : undefined,
        accountName: data.user?.pushname || data.user?.name,
        channelId: data.channel_id || channel.channelId,
        providerStatus, needsRelogin: false,
      };
    } catch (error) {
      console.error('[whatsapp/service] status network failure:', error instanceof Error ? error.message : error);
      return { ok: false, authenticated: false, providerStatus: 'UNKNOWN', needsRelogin: false, error: clientMessage() };
    }
  }

  async function getWhatsAppStatus(userId, includeDiagnostics = false) {
    const providerAvailable = !!existingChannelConfig() || !!partnerConfig();
    const canStartConnect = !!partnerConfig() || !!existingChannelConfig();
    await connections.expireIfStale(userId);
    const row = await connections.getConnectionByUser(userId);

    if (!row || !row.channel_token) {
      return {
        ...toSummary(null, canStartConnect ? 'Scan a QR code with WhatsApp to connect your account.' : 'WhatsApp is not configured on this workspace yet.'),
        providerAvailable, canStartConnect, channelAuthenticated: false, currentUserConnected: false,
      };
    }

    const channel = { baseUrl: normalizeBase(GATE_BASE), token: row.channel_token, channelId: row.provider_channel_id || undefined };
    const probe = await probeChannel(channel);

    if (row.status === 'WAITING_FOR_SCAN' || row.status === 'CREATING_QR') {
      const base = toSummary(row);
      return {
        ...base, status: 'WAITING_FOR_SCAN', connected: false, providerAvailable, canStartConnect,
        channelAuthenticated: probe.authenticated, currentUserConnected: false,
        message: 'Waiting for you to scan the QR code in WhatsApp.',
        diagnostics: includeDiagnostics ? { provider: 'whapi', providerChannelId: row.provider_channel_id || undefined, providerStatus: probe.providerStatus } : undefined,
      };
    }

    if (row.status === 'CONNECTED') {
      if (probe.ok && probe.authenticated) {
        await connections.markPolled(userId);
        const summary = toSummary(row);
        return {
          ...summary, status: 'CONNECTED', connected: true,
          phoneMasked: probe.phone ? maskPhone(probe.phone) : summary.phoneMasked,
          accountName: probe.accountName || summary.accountName,
          providerAvailable, canStartConnect, channelAuthenticated: true, currentUserConnected: true,
          diagnostics: includeDiagnostics ? { provider: 'whapi', providerChannelId: row.provider_channel_id || undefined, providerStatus: probe.providerStatus } : undefined,
        };
      }
      if (probe.needsRelogin) await connections.setStatus(userId, 'DISCONNECTED');
      const current = await connections.getConnectionByUser(userId);
      return {
        ...toSummary(current, clientMessage()),
        status: probe.needsRelogin ? 'DISCONNECTED' : 'ERROR', connected: false,
        providerAvailable, canStartConnect, channelAuthenticated: false, currentUserConnected: false,
        diagnostics: includeDiagnostics ? { provider: 'whapi', providerChannelId: row.provider_channel_id || undefined, providerStatus: probe.providerStatus } : undefined,
      };
    }

    const summary = toSummary(row, row.status === 'EXPIRED' ? 'This QR code has expired. Generate a new one to continue.' : undefined);
    return { ...summary, connected: false, providerAvailable, canStartConnect, channelAuthenticated: probe.authenticated, currentUserConnected: false };
  }

  async function pollWhatsAppConnection(userId) {
    await connections.expireIfStale(userId);
    const row = await connections.getConnectionByUser(userId);
    if (!row?.channel_token) return { ...(await getWhatsAppStatus(userId)), confirmedNow: false };

    let confirmedNow = false;
    if (row.status === 'WAITING_FOR_SCAN') {
      const channel = { baseUrl: normalizeBase(GATE_BASE), token: row.channel_token, channelId: row.provider_channel_id || undefined };
      const probe = await probeChannel(channel);
      await connections.markPolled(userId);

      if (probe.ok && probe.authenticated) {
        const owner = await connections.getConnectedOwnerByToken(row.channel_token);
        if (owner && owner.user_id !== userId) {
          await connections.setStatus(userId, 'DISCONNECTED');
          const taken = await getWhatsAppStatus(userId);
          return { ...taken, confirmedNow: false, message: 'That WhatsApp number was just connected to another account.' };
        }
        const channelMatches = !probe.channelId || !row.provider_channel_id || probe.channelId === row.provider_channel_id;
        if (channelMatches) {
          const identity = probe.phone ? maskPhone(probe.phone) : (probe.accountId ? `id ${probe.accountId.slice(-4).padStart(Math.min(8, probe.accountId.length), '•')}` : null);
          const result = await connections.confirmConnection(userId, row.provider_session_id, {
            phoneMasked: identity, accountName: probe.accountName || null, channelId: probe.channelId || null,
          });
          confirmedNow = result.ok;
        }
      }
    }
    const status = await getWhatsAppStatus(userId);
    return { ...status, confirmedNow };
  }

  async function fetchQrImage(channel) {
    for (let att = 0; att < 4; att++) {
      try {
        const res = await whapiFetch('/users/login?method=qr', channel.token, { method: 'GET' }, channel.baseUrl);
        if (res.ok) {
          const d = await res.json().catch(() => null);
          const raw = d?.base64 || d?.qr || d?.qrCode;
          if (raw && raw.includes('base64,')) return { image: raw, fingerprint: raw.slice(0, 64), expireSeconds: typeof d?.expire === 'number' ? d.expire : undefined };
        }
      } catch (error) {
        console.error('[whatsapp/service] rendered QR attempt failed:', error instanceof Error ? error.message : error);
      }
      try {
        const res = await whapiFetch('/users/login/rowdata', channel.token, { method: 'GET' }, channel.baseUrl);
        if (res.ok) {
          const d = await res.json().catch(() => null);
          if (d?.rowdata) {
            return { image: await QRCode.toDataURL(d.rowdata, { width: 320, margin: 2 }), fingerprint: d.rowdata, expireSeconds: typeof d.expire === 'number' ? d.expire : undefined };
          }
        }
      } catch (error) {
        console.error('[whatsapp/service] rowdata attempt failed:', error instanceof Error ? error.message : error);
      }
      if (att < 3) await new Promise((r) => setTimeout(r, 500 * (att + 1)));
    }
    return null;
  }

  async function createWhatsAppConnectionSession(userId) {
    const prior = await connections.getConnectionByUser(userId);
    if (prior?.channel_token) {
      const priorProbe = await probeChannel({ baseUrl: normalizeBase(GATE_BASE), token: prior.channel_token, channelId: prior.provider_channel_id || undefined });
      if (priorProbe.ok && priorProbe.authenticated) {
        const owner = await connections.getConnectedOwnerByToken(prior.channel_token);
        if (owner?.user_id === userId) {
          await connections.markPolled(userId);
          return { status: 'CONNECTED', message: 'WhatsApp is already connected.' };
        }
        return { status: 'ERROR', message: 'That WhatsApp number is already linked to another account. Disconnect it there first, then connect again.' };
      }
    }

    let channel = await getPendingChannel(userId);
    if (!channel) {
      const partner = partnerConfig();
      if (partner) {
        const name = `SocialPulse user ${userId.slice(0, 8)}`;
        const res = await partnerFetch(partner, '/channels', { method: 'PUT', body: JSON.stringify({ name, projectId: partner.projectId }) });
        if (!res.ok) {
          const raw = await res.text().catch(() => '');
          console.error('[whatsapp/service] partner channel create failed:', res.status, raw.slice(0, 500));
          await connections.setStatus(userId, 'ERROR');
          return { status: 'ERROR', message: clientMessage() };
        }
        const data = await res.json().catch(() => ({}));
        const token = data.token || data.apiToken;
        if (!token) {
          console.error('[whatsapp/service] partner channel create returned no channel token');
          await connections.setStatus(userId, 'ERROR');
          return { status: 'ERROR', message: clientMessage() };
        }
        channel = { baseUrl: normalizeBase(GATE_BASE), token, channelId: data.id || data.channel_id || data.channelId };
      } else {
        const shared = existingChannelConfig();
        if (!shared) {
          await connections.setStatus(userId, 'ERROR');
          return { status: 'ERROR', message: 'WhatsApp is not configured on this workspace yet. An admin needs to add a WhatsApp channel token.' };
        }
        const owner = await connections.getConnectedOwnerByToken(shared.token);
        if (owner && owner.user_id !== userId) {
          const who = owner.owner_email ? maskEmail(owner.owner_email) : 'another account';
          return {
            status: 'ERROR',
            message: `This WhatsApp number is already connected to ${who}. Only one account can use the shared number at a time. Sign in as ${who} and disconnect it there first, or ask an administrator to release it.`,
          };
        }
        channel = shared;
      }
    }

    const attempt = await connections.beginQrAttempt(userId, { channelToken: channel.token, channelId: channel.channelId || null });

    const probe = await whapiFetch('/users/login/rowdata', channel.token, { method: 'GET' }, channel.baseUrl);
    if (probe.status === 409) {
      await connections.attachQrFingerprint(userId, 'already-authenticated');
      return {
        status: 'WAITING_FOR_SCAN', providerSessionId: attempt.provider_session_id || undefined, qrExpiresAt: attempt.qr_expires_at || undefined,
        message: 'This WhatsApp number is already authorised on the server. Disconnect it first, then connect again.',
      };
    }

    try {
      const qr = await fetchQrImage(channel);
      if (!qr) {
        await connections.setStatus(userId, 'ERROR');
        return { status: 'ERROR', message: 'WhatsApp could not prepare a QR code. Please try again.' };
      }
      await connections.attachQrFingerprint(userId, fingerprintQr(qr.fingerprint));
      return {
        status: 'WAITING_FOR_SCAN', qrImage: qr.image, providerSessionId: attempt.provider_session_id || undefined,
        qrExpiresAt: attempt.qr_expires_at || undefined, qrExpiresInSeconds: qr.expireSeconds,
        message: 'Open WhatsApp on your phone, go to Linked Devices, and scan this QR code.',
      };
    } catch (error) {
      console.error('[whatsapp/service] QR network failure:', error instanceof Error ? error.message : error);
      await connections.setStatus(userId, 'ERROR');
      return { status: 'ERROR', message: clientMessage() };
    }
  }

  async function disconnectWhatsApp(userId) {
    const row = await connections.getConnectionByUser(userId);
    await connections.disconnect(userId);
    if (!row?.channel_token) return { providerNotified: false };
    try {
      const res = await whapiFetch('/users/logout', row.channel_token, { method: 'POST' }, normalizeBase(GATE_BASE));
      if (!res.ok && res.status !== 409) {
        const raw = await res.text().catch(() => '');
        console.error('[whatsapp/service] provider logout failed:', res.status, raw.slice(0, 500));
        return { providerNotified: false };
      }
      return { providerNotified: true };
    } catch (err) {
      console.error('[whatsapp/service] provider logout network failure:', err instanceof Error ? err.message : err);
      return { providerNotified: false };
    }
  }

  async function cancelPendingQr(userId) {
    const row = await connections.getConnectionByUser(userId);
    if (row?.status !== 'WAITING_FOR_SCAN' && row?.status !== 'CREATING_QR') return;
    await connections.setStatus(userId, 'CANCELLED');
  }

  async function getWhatsAppCommunities(userId) {
    const channel = await getActiveChannel(userId);
    if (!channel) throw new Error('WhatsApp is not connected.');
    try {
      const commRes = await whapiFetch('/communities', channel.token, { method: 'GET' }, channel.baseUrl);
      if (commRes.ok) {
        const commData = await commRes.json().catch(() => ({}));
        const comms = Array.isArray(commData.communities) ? commData.communities : [];
        if (comms.length) {
          const resolved = await Promise.all(comms
            .filter((c) => c.id && /@g\.us$/.test(String(c.id)))
            .map(async (c) => {
              const parentId = String(c.id);
              const name = String(c.name || 'WhatsApp Community');
              const count = typeof c.participants_count === 'number' ? c.participants_count : typeof c.participantsCount === 'number' ? c.participantsCount : Array.isArray(c.participants) ? c.participants.length : 0;
              let announceId = parentId;
              let announceName = name;
              try {
                const subRes = await whapiFetch(`/communities/${encodeURIComponent(parentId)}/subgroups`, channel.token, { method: 'GET' }, channel.baseUrl);
                if (subRes.ok) {
                  const subData = await subRes.json().catch(() => ({}));
                  if (subData.announceGroupInfo?.id && /@g\.us$/.test(String(subData.announceGroupInfo.id))) {
                    announceId = String(subData.announceGroupInfo.id);
                    announceName = String(subData.announceGroupInfo.title || name);
                  }
                }
              } catch { /* fall back to parent id */ }
              return { id: parentId, name, announcementGroupId: announceId, announcementGroupName: announceName, participantsCount: count, status: 'ready' };
            }));
          return resolved;
        }
      }
    } catch (error) {
      console.error('[whatsapp/service] /communities failed, falling back to /groups:', error instanceof Error ? error.message : error);
    }
    const res = await whapiFetch('/groups?count=500&offset=0', channel.token, { method: 'GET' }, channel.baseUrl);
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      const mapped = whapiError(res.status, raw, 'loading WhatsApp communities');
      console.error('[whatsapp/service] communities failed:', mapped.code, mapped.message);
      throw new Error('WhatsApp communities could not be loaded. Please try again.');
    }
    const data = await res.json().catch(() => ({}));
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const parents = groups.filter((g) => g.id && g.is_parent);
    const announcements = groups.filter((g) => g.id && (g.isCommunityAnnounce || /announcement|announce/i.test(`${g.type || ''} ${g.name || ''}`)));
    const communities = parents.map((parent) => {
      const announce = announcements.find((g) => g.linkedParent === parent.id) || announcements.find((g) => (g.name || '').toLowerCase().includes((parent.name || '').toLowerCase()));
      return announce ? {
        id: String(parent.id), name: String(parent.name || 'WhatsApp Community'),
        announcementGroupId: String(announce.id), announcementGroupName: String(announce.name || 'Announcement Group'),
        participantsCount: announce.participants_count ?? announce.participantsCount ?? 0, status: 'ready',
      } : null;
    }).filter(Boolean);
    if (communities.length) return communities;
    return groups.filter((g) => g.id && /@g\.us$/.test(String(g.id))).map((g) => ({
      id: String(g.id), name: String(g.name || 'WhatsApp Community'), announcementGroupId: String(g.id),
      announcementGroupName: String(g.name || 'Announcement Group'), participantsCount: g.participants_count ?? g.participantsCount ?? 0, status: 'ready',
    }));
  }

  async function listOfficialGroups({ limit = '25', after } = {}) {
    const config = requireOfficialConfig();
    const params = new URLSearchParams({ limit: String(limit || '25') });
    if (after) params.set('after', String(after));
    const data = await graphJson(await waFetch(`/${config.phoneNumberId}/groups?${params.toString()}`, config.accessToken), 'listing groups');
    return { success: true, groups: data.data || [], paging: data.paging || null };
  }

  async function createOfficialGroup({ subject, description, joinApprovalMode }) {
    const config = requireOfficialConfig();
    if (!subject || !String(subject).trim()) {
      const err = new Error('A group subject (name) is required.');
      err.code = 'WHATSAPP_SUBJECT_REQUIRED';
      err.status = 400;
      throw err;
    }
    const data = await graphJson(await waFetch(`/${config.phoneNumberId}/groups`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        subject: String(subject).trim().slice(0, 128),
        ...(description ? { description: String(description).slice(0, 2048) } : {}),
        ...(joinApprovalMode ? { join_approval_mode: joinApprovalMode } : {}),
      }),
    }), 'group creation');
    return { success: true, groupId: data.id };
  }

  async function getOfficialGroup(groupId) {
    const config = requireOfficialConfig();
    const data = await graphJson(await waFetch(`/${encodeURIComponent(groupId)}?fields=${INFO_FIELDS}`, config.accessToken), 'fetching group info');
    return { success: true, group: data };
  }

  async function updateOfficialGroup(groupId, { subject, description }) {
    const config = requireOfficialConfig();
    if (!subject && !description) {
      const err = new Error('Provide a subject and/or description to update.');
      err.code = 'WHATSAPP_NO_CHANGES';
      err.status = 400;
      throw err;
    }
    await graphJson(await waFetch(`/${encodeURIComponent(groupId)}`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        ...(subject ? { subject: String(subject).slice(0, 128) } : {}),
        ...(description ? { description: String(description).slice(0, 2048) } : {}),
      }),
    }), 'updating group settings');
    return { success: true };
  }

  async function deleteOfficialGroup(groupId) {
    const config = requireOfficialConfig();
    await graphJson(await waFetch(`/${encodeURIComponent(groupId)}`, config.accessToken, { method: 'DELETE' }), 'deleting group');
    return { success: true };
  }

  async function getOfficialInviteLink(groupId) {
    const config = requireOfficialConfig();
    const data = await graphJson(await waFetch(`/${encodeURIComponent(groupId)}/invite_link`, config.accessToken), 'fetching invite link');
    return { success: true, inviteLink: data.invite_link };
  }

  async function resetOfficialInviteLink(groupId) {
    const config = requireOfficialConfig();
    const data = await graphJson(await waFetch(`/${encodeURIComponent(groupId)}/invite_link`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp' }),
    }), 'resetting invite link');
    return { success: true, inviteLink: data.invite_link };
  }

  async function sendOfficialGroupMessage(groupId, { message }) {
    const config = requireOfficialConfig();
    if (!message || !String(message).trim()) {
      const err = new Error('A message body is required.');
      err.code = 'WHATSAPP_MESSAGE_REQUIRED';
      err.status = 400;
      throw err;
    }
    const data = await graphJson(await waFetch(`/${config.phoneNumberId}/messages`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'group',
        to: groupId,
        type: 'text',
        text: { preview_url: true, body: String(message) },
      }),
    }), 'sending group message');
    return { success: true, messageId: data.messages?.[0]?.id };
  }

  async function removeOfficialParticipants(groupId, { participants }) {
    const config = requireOfficialConfig();
    if (!Array.isArray(participants) || participants.length === 0) {
      const err = new Error('A non-empty participants array (phone numbers or WhatsApp user IDs) is required.');
      err.code = 'WHATSAPP_PARTICIPANTS_REQUIRED';
      err.status = 400;
      throw err;
    }
    if (participants.length > 8) {
      const err = new Error('Meta caps participant removal at 8 per request - split into multiple calls.');
      err.code = 'WHATSAPP_TOO_MANY_PARTICIPANTS';
      err.status = 400;
      throw err;
    }
    await graphJson(await waFetch(`/${encodeURIComponent(groupId)}/participants`, config.accessToken, {
      method: 'DELETE',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        participants: participants.map((user) => ({ user })),
      }),
    }), 'removing group participants');
    return { success: true };
  }

  async function sendOfficialMessage({ to, message }) {
    const config = requireOfficialConfig();
    if (!to || !message || !String(message).trim()) {
      const err = new Error('Both "to" (phone number, E.164 format e.g. +15551234567) and "message" are required.');
      err.code = 'WHATSAPP_FIELDS_REQUIRED';
      err.status = 400;
      throw err;
    }
    try {
      const data = await graphJson(await waFetch(`/${config.phoneNumberId}/messages`, config.accessToken, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { preview_url: true, body: String(message) },
        }),
      }), 'sending message');
      return { success: true, messageId: data.messages?.[0]?.id };
    } catch (error) {
      const raw = error?.rawBody || '';
      if (/re-?engagement|24.?hour|131047/i.test(raw)) {
        error.code = 'WHATSAPP_OUTSIDE_SERVICE_WINDOW';
        error.message = 'This number has not messaged your business recently, so a plain text message cannot be sent (WhatsApp\'s 24-hour customer service window rule). Use an approved message template instead, or have them message you first.';
      }
      throw error;
    }
  }

  return {
    getWhatsAppStatus, pollWhatsAppConnection, createWhatsAppConnectionSession, disconnectWhatsApp, cancelPendingQr, getWhatsAppCommunities,
    listOfficialGroups, createOfficialGroup, getOfficialGroup, updateOfficialGroup, deleteOfficialGroup,
    getOfficialInviteLink, resetOfficialInviteLink, sendOfficialGroupMessage, removeOfficialParticipants, sendOfficialMessage,
  };
}
