import { whapiError, whapiFetch, maskPhone } from '@/app/api/whapi/client';
import QRCode from 'qrcode';

export type WhatsAppConnectionStatus =
  | 'NOT_CONNECTED'
  | 'CONNECTING'
  | 'VERIFYING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECT_REQUIRED'
  | 'ERROR';

export interface WhatsAppStatus {
  status: WhatsAppConnectionStatus;
  connected: boolean;
  phoneMasked?: string;
  accountName?: string;
  lastVerifiedAt?: string;
  message?: string;
  diagnostics?: {
    provider: 'whapi';
    providerChannelId?: string;
    providerStatus?: string;
  };
}

export interface WhatsAppCommunity {
  id: string;
  name: string;
  announcementGroupId: string;
  announcementGroupName: string;
  status: 'ready' | 'needs_attention';
  participantsCount?: number;
}

type ChannelConfig = { baseUrl: string; token: string; channelId?: string };

const GATE_BASE = process.env.WHAPI_API_BASE || 'https://gate.whapi.cloud';
const MANAGER_BASE = process.env.WHATSAPP_PARTNER_API_BASE || 'https://manager.whapi.cloud';

function normalizeBase(url: string) {
  const clean = url.trim().replace(/\/+$/, '');
  return clean.startsWith('http') ? clean : `https://${clean}`;
}

function existingChannelConfig(): ChannelConfig | null {
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

async function partnerFetch(path: string, init?: RequestInit) {
  const config = partnerConfig();
  if (!config) throw new Error('WHATSAPP_PARTNER_NOT_CONFIGURED');
  const url = `${config.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
      ...(init?.headers || {}),
    },
  });
}

function clientMessage(): string {
  return 'WhatsApp connection could not be completed. Please try connecting again.';
}

async function getActiveChannel(): Promise<ChannelConfig | null> {
  // Keeps today's single-channel deployment working while the partner channel
  // store is added. The token remains server-only and never reaches UI.
  return existingChannelConfig();
}

export async function getWhatsAppStatus(includeDiagnostics = false): Promise<WhatsAppStatus> {
  const channel = await getActiveChannel();
  if (!channel) {
    return {
      status: partnerConfig() ? 'NOT_CONNECTED' : 'ERROR',
      connected: false,
      message: partnerConfig()
        ? 'Connect your WhatsApp account to publish directly from SocialPulse.'
        : 'WhatsApp connection setup is not enabled on this SocialPulse workspace yet.',
    };
  }

  try {
    const res = await whapiFetch('/health', channel.token, { method: 'GET' }, channel.baseUrl);
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      const mapped = whapiError(res.status, raw, 'connection verification');
      console.error('[whatsapp/service] status verification failed:', mapped.code, mapped.message);
      return { status: res.status === 401 ? 'RECONNECT_REQUIRED' : 'ERROR', connected: false, message: clientMessage() };
    }
    const data = await res.json().catch(() => ({})) as {
      status?: { text?: string };
      user?: { phone?: string; name?: string; pushname?: string };
      channel_id?: string;
    };
    const providerStatus = data.status?.text || 'UNKNOWN';
    const connected = !!data.user?.phone || ['AUTH', 'LAUNCH', 'INIT'].includes(providerStatus);
    return {
      status: connected ? 'CONNECTED' : 'CONNECTING',
      connected,
      phoneMasked: data.user?.phone ? maskPhone(data.user.phone) : undefined,
      accountName: data.user?.pushname || data.user?.name || undefined,
      lastVerifiedAt: new Date().toISOString(),
      message: connected ? undefined : 'Please scan the QR code with WhatsApp.',
      diagnostics: includeDiagnostics ? { provider: 'whapi', providerChannelId: data.channel_id || channel.channelId, providerStatus } : undefined,
    };
  } catch (error) {
    console.error('[whatsapp/service] status network failure:', error instanceof Error ? error.message : error);
    return { status: 'ERROR', connected: false, message: clientMessage() };
  }
}

export async function createWhatsAppConnectionSession(): Promise<{ status: WhatsAppConnectionStatus; qrImage?: string; message?: string }> {
  let channel = await getActiveChannel();

  if (!channel) {
    const partner = partnerConfig();
    if (!partner) {
      return { status: 'ERROR', message: 'WhatsApp connection setup is not enabled on this SocialPulse workspace yet.' };
    }

    const name = `SocialPulse ${new Date().toISOString()}`;
    const res = await partnerFetch('/channels', {
      method: 'PUT',
      body: JSON.stringify({ name, projectId: partner.projectId }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      console.error('[whatsapp/service] partner channel create failed:', res.status, raw.slice(0, 500));
      return { status: 'ERROR', message: clientMessage() };
    }
    const data = await res.json().catch(() => ({})) as { token?: string; apiToken?: string; id?: string; channel_id?: string; channelId?: string };
    const token = data.token || data.apiToken;
    if (!token) {
      console.error('[whatsapp/service] partner channel create returned no channel token');
      return { status: 'ERROR', message: clientMessage() };
    }
    channel = { baseUrl: normalizeBase(GATE_BASE), token, channelId: data.id || data.channel_id || data.channelId };
    // TODO: persist channel token encrypted per workspace once workspace storage exists.
  }

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await whapiFetch('/users/login/rowdata', channel.token, { method: 'GET' }, channel.baseUrl);
      if (res.status === 409) return { status: 'CONNECTED' };
      const data = res.ok ? await res.json().catch(() => ({})) as { rowdata?: string } : null;
      if (data?.rowdata) {
        return { status: 'CONNECTING', qrImage: await QRCode.toDataURL(data.rowdata, { width: 320, margin: 2 }) };
      }
      if (res.status !== 422 && (!res.ok || attempt === 2)) {
        console.error('[whatsapp/service] QR request failed:', res.status);
        break;
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    return { status: 'ERROR', message: 'WhatsApp could not prepare a QR code. Please try again.' };
  } catch (error) {
    console.error('[whatsapp/service] QR network failure:', error instanceof Error ? error.message : error);
    return { status: 'ERROR', message: clientMessage() };
  }
}

export async function disconnectWhatsApp(): Promise<void> {
  const channel = await getActiveChannel();
  if (!channel) return;
  const res = await whapiFetch('/users/logout', channel.token, { method: 'POST' }, channel.baseUrl);
  if (!res.ok && res.status !== 409) {
    const raw = await res.text().catch(() => '');
    console.error('[whatsapp/service] disconnect failed:', res.status, raw.slice(0, 500));
    throw new Error(clientMessage());
  }
}

export async function getWhatsAppCommunities(): Promise<WhatsAppCommunity[]> {
  const channel = await getActiveChannel();
  if (!channel) throw new Error('WhatsApp is not connected.');
  // Prefer the real Whapi /communities endpoint (returns true communities with
  // real participants_count). Fall back to /groups inference only if unavailable.
  try {
    const commRes = await whapiFetch('/communities', channel.token, { method: 'GET' }, channel.baseUrl);
    if (commRes.ok) {
      const commData = await commRes.json().catch(() => ({})) as { communities?: Array<{ id?: string; name?: string; participants_count?: number; participantsCount?: number; participants?: unknown[] }> };
      const comms = Array.isArray(commData.communities) ? commData.communities : [];
      if (comms.length) {
        // Resolve each community parent -> its sendable announce group via
        // GET /communities/{id}/subgroups (announceGroupInfo.id). Sending to the
        // parent JID itself gets a 400 from Whapi, so this mapping is required.
        const resolved = await Promise.all(comms
          .filter(c => c.id && /@g\.us$/.test(String(c.id)))
          .map(async c => {
            const parentId = String(c.id);
            const name = String(c.name || 'WhatsApp Community');
            const count = typeof c.participants_count === 'number' ? c.participants_count
              : typeof c.participantsCount === 'number' ? c.participantsCount
              : Array.isArray(c.participants) ? c.participants.length : 0;
            let announceId = parentId;
            let announceName = name;
            try {
              const subRes = await whapiFetch(`/communities/${encodeURIComponent(parentId)}/subgroups`, channel.token, { method: 'GET' }, channel.baseUrl);
              if (subRes.ok) {
                const subData = await subRes.json().catch(() => ({})) as { announceGroupInfo?: { id?: string; title?: string } };
                if (subData.announceGroupInfo?.id && /@g\.us$/.test(String(subData.announceGroupInfo.id))) {
                  announceId = String(subData.announceGroupInfo.id);
                  announceName = String(subData.announceGroupInfo.title || name);
                }
              }
            } catch {
              // Fall back to parent id; publish will surface Whapi's 400 with the right JID.
            }
            return {
              id: parentId,
              name,
              announcementGroupId: announceId,
              announcementGroupName: announceName,
              participantsCount: count,
              status: 'ready' as const,
            };
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
  const data = await res.json().catch(() => ({})) as { groups?: Array<{ id?: string; name?: string; participants_count?: number; participantsCount?: number; type?: string; is_parent?: boolean; isCommunityAnnounce?: boolean; linkedParent?: string }> };
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const parents = groups.filter(g => g.id && g.is_parent);
  const announcements = groups.filter(g => g.id && (g.isCommunityAnnounce || /announcement|announce/i.test(`${g.type || ''} ${g.name || ''}`)));
  const communities = parents.map(parent => {
    const announce = announcements.find(g => g.linkedParent === parent.id) || announcements.find(g => (g.name || '').toLowerCase().includes((parent.name || '').toLowerCase()));
    return announce ? {
      id: String(parent.id),
      name: String(parent.name || 'WhatsApp Community'),
      announcementGroupId: String(announce.id),
      announcementGroupName: String(announce.name || 'Announcement Group'),
      participantsCount: announce.participants_count ?? announce.participantsCount ?? 0,
      status: 'ready' as const,
    } : null;
  }).filter(Boolean) as WhatsAppCommunity[];

  if (communities.length) return communities;

  return groups
    .filter(g => g.id && /@g\.us$/.test(String(g.id)))
    .map(g => ({
      id: String(g.id),
      name: String(g.name || 'WhatsApp Community'),
      announcementGroupId: String(g.id),
      announcementGroupName: String(g.name || 'Announcement Group'),
      participantsCount: g.participants_count ?? g.participantsCount ?? 0,
      status: 'ready' as const,
    }));
}

export async function publishWhatsAppMessage(input: { communityId?: string; announcementGroupId?: string; text?: string; mediaList?: Array<{ url?: string; type?: string; name?: string }>; attemptId?: string }) {
  const { POST } = await import('@/app/api/whapi/publish/route');
  const req = new Request('http://socialpulse.local/api/whapi/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId: input.announcementGroupId || input.communityId,
      text: input.text,
      mediaList: input.mediaList,
      attemptId: input.attemptId,
    }),
  });
  return POST(req as never);
}
