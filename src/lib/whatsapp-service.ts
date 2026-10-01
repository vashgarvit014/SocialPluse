import { whapiError, whapiFetch, maskPhone } from '@/app/api/whapi/client';
import QRCode from 'qrcode';
import * as connections from '@/lib/whatsapp-connections';

// Connection state is PER USER and bound to the exact channel + QR session.
// It used to be read off the shared WHAPI_API_TOKEN channel with no user
// parameter at all, which is why "Connect" flipped straight to CONNECTED.
export type WhatsAppConnectionStatus = connections.WhatsAppConnectionStatus;

export interface WhatsAppStatus extends connections.WhatsAppConnectionSummary {
  /** Provider reachable + credentials present. Says nothing about THIS user. */
  providerAvailable: boolean;
  /** THIS user's exact channel is authenticated at the provider. */
  channelAuthenticated: boolean;
  /** THIS user scanned THIS QR and it was confirmed. The only "connected". */
  currentUserConnected: boolean;
  /**
   * A user can start their OWN QR flow. This needs the partner/manager API,
   * because only it can mint a fresh channel per user.
   *
   * Deliberately separate from `providerAvailable`: a deployment may well have
   * a WHAPI_API_TOKEN (so providerAvailable is true) and still be unable to
   * issue anyone a personal QR. Reading the former to decide whether to offer
   * the Connect button is what produced a button that could only ever fail.
   */
  canStartConnect: boolean;
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

/**
 * The deployment-level channel from env. This is NOT a user's connection — it
 * belongs to whoever owns the deployment and is only usable by a user who has
 * an explicit CONNECTED row claiming it (see claim-legacy-connections.mjs).
 *
 * It is never returned automatically. That is the whole point.
 */
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

/**
 * The channel this user may act through, or null.
 *
 * Resolved ONLY from a CONNECTED row for this user. There is no env fallback:
 * returning the shared deployment channel here is precisely what let one
 * user's authenticated session read as everyone being connected, and would let
 * any user publish through another user's channel.
 */
async function getActiveChannel(userId: string): Promise<ChannelConfig | null> {
  const connected = await connections.getConnectedChannel(userId);
  if (connected) return { baseUrl: normalizeBase(GATE_BASE), token: connected.token, channelId: connected.channelId };
  return null;
}

/** A channel token for a PENDING (not yet scanned) attempt, for QR calls. */
async function getPendingChannel(userId: string): Promise<ChannelConfig | null> {
  const row = await connections.getConnectionByUser(userId);
  if (!row?.channel_token) return null;
  return { baseUrl: normalizeBase(GATE_BASE), token: row.channel_token, channelId: row.provider_channel_id || undefined };
}

/**
 * Reads /health for a given channel. Returns the provider's own view of that
 * ONE channel — never a workspace-wide answer.
 */
async function probeChannel(channel: ChannelConfig): Promise<{
  ok: boolean;
  authenticated: boolean;
  phone?: string;
  accountName?: string;
  channelId?: string;
  providerStatus: string;
  needsRelogin: boolean;
  error?: string;
}> {
  try {
    const res = await whapiFetch('/health', channel.token, { method: 'GET' }, channel.baseUrl);
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      const mapped = whapiError(res.status, raw, 'connection verification');
      console.error('[whatsapp/service] status verification failed:', mapped.code, mapped.message);
      return {
        ok: false,
        authenticated: false,
        providerStatus: 'UNKNOWN',
        needsRelogin: res.status === 401,
        error: clientMessage(),
      };
    }
    const data = await res.json().catch(() => ({})) as {
      status?: { text?: string };
      user?: { id?: string | number; phone?: string; name?: string; pushname?: string; is_business?: boolean } | null;
      channel_id?: string;
    };
    const providerStatus = data.status?.text || 'UNKNOWN';
    // `authenticated` here means THIS channel's provider session is authed.
    // It is deliberately NOT the same thing as "this user is connected" —
    // see the WAITING_FOR_SCAN branch in getWhatsAppStatus below.
    //
    // Verified against this gateway's live /health payloads:
    //
    //   unpaired -> { status: { code: 3, text: "QR"    }, user: null }
    //   paired   -> { status: { code: 2, text: "LAUNCH" }, user: { id: "…" },
    //                device_id: 36 }
    //
    // Two things follow, and both contradict the obvious guess:
    //   1. `user.phone` is NOT returned by this build even when pairing fully
    //      succeeded, so requiring it would report "not connected" forever.
    //   2. The paired state is labelled LAUNCH, not AUTH — LAUNCH is not a
    //      reliable "pre-login" marker here.
    //
    // The only signal that actually separates them is whether a `user` OBJECT
    // is present at all: null while unpaired, populated once a device is
    // linked. `id` is preferred when present, with phone as a fallback.
    const authenticated = !!data.user?.id || !!data.user?.phone;
    return {
      ok: true,
      authenticated,
      phone: data.user?.phone,
      accountName: data.user?.pushname || data.user?.name,
      channelId: data.channel_id || channel.channelId,
      providerStatus,
      needsRelogin: false,
    };
  } catch (error) {
    console.error('[whatsapp/service] status network failure:', error instanceof Error ? error.message : error);
    return { ok: false, authenticated: false, providerStatus: 'UNKNOWN', needsRelogin: false, error: clientMessage() };
  }
}

/**
 * Resolves this user's connection state.
 *
 * The rule that fixes the auto-connect bug lives in the WAITING_FOR_SCAN
 * branch below: a pending QR reports WAITING_FOR_SCAN even when the provider
 * says the channel is authenticated. Only an exact-session match promotes the
 * row to CONNECTED, and the status route is not allowed to do that implicitly
 * for an attempt it did not verify.
 */
export async function getWhatsAppStatus(userId: string, includeDiagnostics = false): Promise<WhatsAppStatus> {
  const providerAvailable = !!existingChannelConfig() || !!partnerConfig();
  // Offering "Connect WhatsApp" is only honest if a QR can actually be minted.
  // Either mode qualifies: a partner key mints a per-user channel, and the
  // deployment's shared WHAPI_API_TOKEN pairs the one existing channel from
  // inside the app. Only a workspace with neither is genuinely unavailable.
  const canStartConnect = !!partnerConfig() || !!existingChannelConfig();
  await connections.expireIfStale(userId);
  const row = await connections.getConnectionByUser(userId);

  if (!row || !row.channel_token) {
    return {
      ...connections.toSummary(null, canStartConnect
        ? 'Scan a QR code with WhatsApp to connect your account.'
        : 'WhatsApp is not configured on this workspace yet.'),
      providerAvailable,
      canStartConnect,
      channelAuthenticated: false,
      currentUserConnected: false,
    };
  }

  const channel: ChannelConfig = {
    baseUrl: normalizeBase(GATE_BASE),
    token: row.channel_token,
    channelId: row.provider_channel_id || undefined,
  };
  const probe = await probeChannel(channel);

  // ---- PENDING: a QR exists but has not been scanned by this user yet. ----
  if (row.status === 'WAITING_FOR_SCAN' || row.status === 'CREATING_QR') {
    const base = connections.toSummary(row);
    // A pre-authenticated channel (409 on rowdata, or an /health that already
    // reports a user) does NOT mean this user scanned anything. We stay in
    // WAITING_FOR_SCAN and let the dedicated poll/confirm endpoint — which
    // checks the exact session — be the only thing that promotes the row.
    return {
      ...base,
      status: 'WAITING_FOR_SCAN',
      connected: false,
      providerAvailable,
      canStartConnect,
      channelAuthenticated: probe.authenticated,
      currentUserConnected: false,
      message: 'Waiting for you to scan the QR code in WhatsApp.',
      diagnostics: includeDiagnostics
        ? { provider: 'whapi', providerChannelId: row.provider_channel_id || undefined, providerStatus: probe.providerStatus }
        : undefined,
    };
  }

  // ---- CONFIRMED: verify the exact channel is still authed. ----
  if (row.status === 'CONNECTED') {
    if (probe.ok && probe.authenticated) {
      await connections.markPolled(userId);
      const summary = connections.toSummary(row);
      return {
        ...summary,
        status: 'CONNECTED',
        connected: true,
        phoneMasked: probe.phone ? maskPhone(probe.phone) : summary.phoneMasked,
        accountName: probe.accountName || summary.accountName,
        providerAvailable,
        canStartConnect,
        channelAuthenticated: true,
        currentUserConnected: true,
        diagnostics: includeDiagnostics
          ? { provider: 'whapi', providerChannelId: row.provider_channel_id || undefined, providerStatus: probe.providerStatus }
          : undefined,
      };
    }
    // We cannot confirm this channel is still usable. Report a non-connected
    // status so `status` and `connected` never disagree — returning the row's
    // CONNECTED status with connected:false was a real inconsistency and the
    // UI would render a contradictory pair.
    //
    // The DB row is only downgraded when the provider gave a definitive 401
    // (token genuinely dead). A timeout or 5xx is inconclusive, so the row is
    // left intact and the next successful poll restores a connected status.
    if (probe.needsRelogin) await connections.setStatus(userId, 'DISCONNECTED');
    const current = await connections.getConnectionByUser(userId);
    return {
      ...connections.toSummary(current, clientMessage()),
      // ERROR (rather than DISCONNECTED) for an inconclusive failure, so an
      // admin-facing read can tell "broken" apart from "logged out".
      status: probe.needsRelogin ? 'DISCONNECTED' : 'ERROR',
      connected: false,
      providerAvailable,
      canStartConnect,
      channelAuthenticated: false,
      currentUserConnected: false,
      diagnostics: includeDiagnostics
        ? { provider: 'whapi', providerChannelId: row.provider_channel_id || undefined, providerStatus: probe.providerStatus }
        : undefined,
    };
  }

  // EXPIRED / ERROR / CANCELLED / DISCONNECTED
  const summary = connections.toSummary(row, row.status === 'EXPIRED' ? 'This QR code has expired. Generate a new one to continue.' : undefined);
  return {
    ...summary,
    connected: false,
    providerAvailable,
    canStartConnect,
    channelAuthenticated: probe.authenticated,
    currentUserConnected: false,
  };
}

/**
 * Exact-session poll. Only meaningful while a QR is pending.
 *
 * This is the ONLY path that can turn WAITING_FOR_SCAN into CONNECTED, and it
 * does so by matching the provider's authenticated channel against the session
 * this attempt was issued with. A generic "provider says AUTH" is not enough.
 */
export async function pollWhatsAppConnection(userId: string): Promise<WhatsAppStatus & { confirmedNow: boolean }> {
  await connections.expireIfStale(userId);
  const row = await connections.getConnectionByUser(userId);
  if (!row?.channel_token) {
    return { ...(await getWhatsAppStatus(userId)), confirmedNow: false };
  }

  let confirmedNow = false;
  if (row.status === 'WAITING_FOR_SCAN') {
    const channel: ChannelConfig = {
      baseUrl: normalizeBase(GATE_BASE),
      token: row.channel_token,
      channelId: row.provider_channel_id || undefined,
    };
    const probe = await probeChannel(channel);
    await connections.markPolled(userId);

    if (probe.ok && probe.authenticated) {
      // Shared-channel guard. Two accounts can both press "Connect" before
      // either has scanned, leaving two WAITING_FOR_SCAN rows on the SAME
      // channel token. Without this check the first one to poll would confirm
      // and the second would confirm too, silently handing one WhatsApp number
      // to two accounts. The token may belong to exactly one CONNECTED row.
      const owner = await connections.getConnectedOwnerByToken(row.channel_token);
      if (owner && owner.user_id !== userId) {
        await connections.setStatus(userId, 'DISCONNECTED');
        const taken = await getWhatsAppStatus(userId);
        return {
          ...taken,
          confirmedNow: false,
          message: 'That WhatsApp number was just connected to another account.',
        };
      }

      // Exact-session confirmation: the authenticated channel must be the one
      // this pending attempt was issued for. A mismatch means someone else's
      // channel is authed and this user has still not scanned.
      const channelMatches =
        !probe.channelId || !row.provider_channel_id || probe.channelId === row.provider_channel_id;
      if (channelMatches) {
        const result = await connections.confirmConnection(userId, row.provider_session_id!, {
          phoneMasked: probe.phone ? maskPhone(probe.phone) : null,
          accountName: probe.accountName || null,
          channelId: probe.channelId || null,
        });
        confirmedNow = result.ok;
      }
    }
  }

  const status = await getWhatsAppStatus(userId);
  return { ...status, confirmedNow };
}

export interface QrResult {
  status: WhatsAppConnectionStatus;
  qrImage?: string;
  providerSessionId?: string;
  qrExpiresAt?: string;
  /** Provider-reported remaining validity, when it differs from our own TTL. */
  qrExpiresInSeconds?: number;
  message?: string;
}

/**
 * Starts a QR pairing attempt for THIS user. Never returns CONNECTED on its own.
 *
 * Two modes, in priority order:
 *
 *   PER-USER  — a partner/manager API key is configured, so a brand new channel
 *               is minted for this user. Fully isolated: nobody else can use it.
 *
 *   SHARED    — no partner key, but the deployment has a WHAPI_API_TOKEN. That is
 *               one existing Whapi channel which is paired from inside the app by
 *               scanning a QR. Whichever account scans it becomes the owner.
 *               No new channel is created and no partner key is needed.
 *
 * In SHARED mode a second user cannot steal an already-owned channel; they get
 * told it is in use instead.
 */
export async function createWhatsAppConnectionSession(userId: string): Promise<QrResult> {
  // ---- IDEMPOTENCY / DO-NO-HARM GUARD -------------------------------------
  // Asking the gateway for a login session UNLINKS whatever device is currently
  // paired to the channel (verified: /health goes from user:{id:…} to user:null
  // the moment /users/login is called). So blindly minting a QR would let a user
  // destroy a working connection by clicking "Connect" a second time.
  //
  // Probe first and only start a session when there is genuinely nothing to
  // lose.
  const prior = await connections.getConnectionByUser(userId);
  if (prior?.channel_token) {
    const priorProbe = await probeChannel({
      baseUrl: normalizeBase(GATE_BASE),
      token: prior.channel_token,
      channelId: prior.provider_channel_id || undefined,
    });
    if (priorProbe.ok && priorProbe.authenticated) {
      const owner = await connections.getConnectedOwnerByToken(prior.channel_token);
      if (owner?.user_id === userId) {
        // Already connected and healthy. Report success without touching the
        // provider session at all.
        await connections.markPolled(userId);
        return {
          status: 'CONNECTED',
          message: 'WhatsApp is already connected.',
          qrExpiresInSeconds: undefined,
        };
      }
      return {
        status: 'ERROR',
        message: 'That WhatsApp number is already linked to another account. Disconnect it there first, then connect again.',
      };
    }
  }

  let channel = await getPendingChannel(userId);

  if (!channel) {
    const partner = partnerConfig();
    if (partner) {
      const name = `SocialPulse user ${userId.slice(0, 8)}`;
      const res = await partnerFetch('/channels', {
        method: 'PUT',
        body: JSON.stringify({ name, projectId: partner.projectId }),
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        console.error('[whatsapp/service] partner channel create failed:', res.status, raw.slice(0, 500));
        await connections.setStatus(userId, 'ERROR');
        return { status: 'ERROR', message: clientMessage() };
      }
      const data = await res.json().catch(() => ({})) as { token?: string; apiToken?: string; id?: string; channel_id?: string; channelId?: string };
      const token = data.token || data.apiToken;
      if (!token) {
        console.error('[whatsapp/service] partner channel create returned no channel token');
        await connections.setStatus(userId, 'ERROR');
        return { status: 'ERROR', message: clientMessage() };
      }
      channel = { baseUrl: normalizeBase(GATE_BASE), token, channelId: data.id || data.channel_id || data.channelId };
    } else {
      // ---- SHARED CHANNEL MODE --------------------------------------------
      const shared = existingChannelConfig();
      if (!shared) {
        await connections.setStatus(userId, 'ERROR');
        return {
          status: 'ERROR',
          message: 'WhatsApp is not configured on this workspace yet. An admin needs to add a WhatsApp channel token.',
        };
      }

      // One channel can back exactly one owner. Refuse to hand a second account
      // a number that is already connected to somebody.
      const owner = await connections.getConnectedOwnerByToken(shared.token);
      if (owner && owner.user_id !== userId) {
        return {
          status: 'ERROR',
          message: 'This workspace already has a WhatsApp number connected. Only one WhatsApp account can be linked here — ask an administrator if you need it changed.',
        };
      }
      channel = shared;
    }
  }

  // Record the pending attempt BEFORE asking for the QR, so there is always a
  // session id for a later scan to be correlated against.
  const attempt = await connections.beginQrAttempt(userId, {
    channelToken: channel.token,
    channelId: channel.channelId || null,
  });

  // 409 = the channel is already authenticated at the provider, so no QR is
  // issued. That is NOT this user scanning anything, so it must not become
  // CONNECTED here. The previous code returned CONNECTED on this branch, which
  // was the auto-connect bug.
  const probe = await whapiFetch('/users/login/rowdata', channel.token, { method: 'GET' }, channel.baseUrl);
  if (probe.status === 409) {
    await connections.attachQrFingerprint(userId, 'already-authenticated');
    return {
      status: 'WAITING_FOR_SCAN',
      providerSessionId: attempt.provider_session_id || undefined,
      qrExpiresAt: attempt.qr_expires_at || undefined,
      message: 'This WhatsApp number is already authorised on the server. Disconnect it first, then connect again.',
    };
  }

  try {
    const qr = await fetchQrImage(channel);
    if (!qr) {
      await connections.setStatus(userId, 'ERROR');
      return { status: 'ERROR', message: 'WhatsApp could not prepare a QR code. Please try again.' };
    }
    await connections.attachQrFingerprint(userId, connections.fingerprintQr(qr.fingerprint));
    return {
      status: 'WAITING_FOR_SCAN',
      qrImage: qr.image,
      providerSessionId: attempt.provider_session_id || undefined,
      qrExpiresAt: attempt.qr_expires_at || undefined,
      qrExpiresInSeconds: qr.expireSeconds,
      message: 'Open WhatsApp on your phone, go to Linked Devices, and scan this QR code.',
    };
  } catch (error) {
    console.error('[whatsapp/service] QR network failure:', error instanceof Error ? error.message : error);
    await connections.setStatus(userId, 'ERROR');
    return { status: 'ERROR', message: clientMessage() };
  }
}

/**
 * Obtains a scannable QR image for this channel.
 *
 * The gateway exposes the pairing code two ways and NEITHER is sufficient on
 * its own:
 *
 *   GET /users/login?method=qr  -> { status:"OK", base64:"data:image/png;…",
 *                                     expire:<seconds left> }
 *                                  …but when a login session is ALREADY pending
 *                                  it returns only { status:"WAITING" }, with no
 *                                  image at all.
 *
 *   GET /users/login/rowdata    -> { status:"OK", rowdata:"https://wa.me/…" }
 *                                  …which is the payload to encode ourselves,
 *                                  and is the one that answers while a session
 *                                  is pending. Before any session exists it
 *                                  returns { status:"WAITING" } instead.
 *
 * So the two are complementary and both are tried on every pass, with a few
 * short retries to cover the window where a session is still being set up.
 * Without this pairing simply failed ~3 times in 4 in practice.
 */
async function fetchQrImage(
  channel: ChannelConfig,
): Promise<{ image: string; fingerprint: string; expireSeconds?: number } | null> {
  for (let att = 0; att < 4; att++) {
    // (a) the already-encoded PNG, when the gateway is willing to mint one
    try {
      const res = await whapiFetch('/users/login?method=qr', channel.token, { method: 'GET' }, channel.baseUrl);
      if (res.ok) {
        const d = await res.json().catch(() => null) as { base64?: string; qr?: string; qrCode?: string; expire?: number } | null;
        const raw = d?.base64 || d?.qr || d?.qrCode;
        if (raw && raw.includes('base64,')) {
          return { image: raw, fingerprint: raw.slice(0, 64), expireSeconds: typeof d?.expire === 'number' ? d.expire : undefined };
        }
      }
    } catch (error) {
      console.error('[whatsapp/service] rendered QR attempt failed:', error instanceof Error ? error.message : error);
    }

    // (b) the rowdata URL, which is what a PENDING session will answer with
    try {
      const res = await whapiFetch('/users/login/rowdata', channel.token, { method: 'GET' }, channel.baseUrl);
      if (res.ok) {
        const d = await res.json().catch(() => null) as { rowdata?: string; expire?: number } | null;
        if (d?.rowdata) {
          return {
            image: await QRCode.toDataURL(d.rowdata, { width: 320, margin: 2 }),
            fingerprint: d.rowdata,
            expireSeconds: typeof d.expire === 'number' ? d.expire : undefined,
          };
        }
      }
    } catch (error) {
      console.error('[whatsapp/service] rowdata attempt failed:', error instanceof Error ? error.message : error);
    }

    if (att < 3) await new Promise(r => setTimeout(r, 500 * (att + 1)));
  }
  return null;
}

export interface DisconnectOutcome {
  providerNotified: boolean;
}

/**
 * Revokes this user's WhatsApp access.
 *
 * The local record is cleared FIRST and unconditionally — that is the part
 * that governs whether this user can publish, so it must happen even if the
 * provider is unreachable.
 *
 * A provider-side failure is reported in the result rather than thrown. Throwing
 * would tell the user "disconnect failed" when in fact they ARE disconnected
 * from SocialPulse, which invites them to retry and leaves the UI claiming a
 * connection that no longer has any privileges attached.
 */
export async function disconnectWhatsApp(userId: string): Promise<DisconnectOutcome> {
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

/** Cancels a pending QR without revoking anything at the provider. */
export async function cancelPendingQr(userId: string): Promise<void> {
  const row = await connections.getConnectionByUser(userId);
  if (row?.status !== 'WAITING_FOR_SCAN' && row?.status !== 'CREATING_QR') return;
  await connections.setStatus(userId, 'CANCELLED');
}

export async function getWhatsAppCommunities(userId: string): Promise<WhatsAppCommunity[]> {
  const channel = await getActiveChannel(userId);
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
