import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { query, queryOne, withTransaction } from '@/lib/db';

// Per-user WhatsApp (Whapi) connection lifecycle.
//
// The bug this module exists to fix
// --------------------------------
// Connection state used to be derived from the SHARED WHAPI_API_TOKEN channel:
// getWhatsAppStatus() probed that one channel's /health and reported CONNECTED
// to whoever asked, and /users/login/rowdata returning 409 ("already
// authenticated, no QR needed") was returned to the caller as CONNECTED.
// Net effect: clicking "Connect WhatsApp" flipped the UI to CONNECTED without
// anyone scanning anything.
//
// The fix is a real per-user record bound to the exact provider channel AND the
// exact QR attempt. Three states are now kept strictly separate:
//
//   WHAPI_PROVIDER_AVAILABLE      the provider is reachable at all
//   WHAPI_CHANNEL_AUTHENTICATED   THIS user's exact channel is authed at Whapi
//   CURRENT_USER_WHATSAPP_CONNECTED  THIS user scanned THIS QR and confirmed
//
// Only the last one is what the UI shows as "Connected".

export type WhatsAppConnectionStatus =
  | 'DISCONNECTED'
  | 'CREATING_QR'
  | 'WAITING_FOR_SCAN'
  | 'CONNECTED'
  | 'EXPIRED'
  | 'ERROR'
  | 'CANCELLED';

export interface WhatsAppConnectionRow {
  id: string;
  user_id: string;
  provider: 'WHAPI';
  provider_channel_id: string | null;
  provider_session_id: string | null;
  channel_token: string | null;
  status: WhatsAppConnectionStatus;
  qr_fingerprint: string | null;
  qr_created_at: string | null;
  qr_expires_at: string | null;
  phone_masked: string | null;
  account_name: string | null;
  last_polled_at: string | null;
  confirmed_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, user_id, provider, provider_channel_id, provider_session_id, channel_token, status, ' +
  'qr_fingerprint, qr_created_at, qr_expires_at, phone_masked, account_name, last_polled_at, ' +
  'confirmed_at, connected_at, disconnected_at, created_at, updated_at';

/** How long a QR stays valid. Whapi QR payloads rotate well before this. */
export const QR_TTL_MS = 5 * 60 * 1000;

/**
 * Stable fingerprint of a QR payload. Lets us tell "still the same pending QR"
 * from "provider rotated it" without ever storing the QR contents themselves.
 */
export function fingerprintQr(rowdata: string): string {
  return createHash('sha256').update(rowdata).digest('hex').slice(0, 32);
}

function newSessionId(): string {
  return `waseq_${randomUUID()}`;
}

/** The single source of truth for "this user's WhatsApp connection". */
export async function getConnectionByUser(userId: string): Promise<WhatsAppConnectionRow | null> {
  return queryOne<WhatsAppConnectionRow>(`SELECT ${COLUMNS} FROM whatsapp_connections WHERE user_id = $1`, [userId]);
}

/**
 * Resolves the channel token a user may publish through.
 *
 * This is the ONLY function the publish/group paths use, and it deliberately
 * returns a token ONLY for a CONNECTED row. That is what stops the shared
 * deployment channel from being used by whoever happens to be logged in:
 * there is no code path from "some other user scanned a QR" to "publish as
 * this user".
 */
export async function getConnectedChannel(userId: string): Promise<{ token: string; channelId?: string } | null> {
  const row = await queryOne<{ channel_token: string | null; provider_channel_id: string | null }>(
    `SELECT channel_token, provider_channel_id FROM whatsapp_connections
      WHERE user_id = $1 AND status = 'CONNECTED' AND channel_token IS NOT NULL`,
    [userId],
  );
  if (!row?.channel_token) return null;
  return { token: row.channel_token, channelId: row.provider_channel_id || undefined };
}

/**
 * Starts (or restarts) a QR attempt for this user.
 *
 * Never sets CONNECTED. The caller gets WAITING_FOR_SCAN and must wait for a
 * scan confirmed against this exact session.
 */
export async function beginQrAttempt(
  userId: string,
  params: { channelToken: string; channelId?: string | null },
): Promise<WhatsAppConnectionRow> {
  const now = new Date();
  const nowIso = now.toISOString();
  const sessionId = newSessionId();
  return withTransaction(async (tx) => {
    // Insert-or-replace this user's single row. Any previous CONNECTED state is
    // intentionally overwritten: the user asked for a new pairing, so the old
    // one must stop granting publish rights.
    const row = await tx.queryOne<WhatsAppConnectionRow>(
      `INSERT INTO whatsapp_connections
         (id, user_id, provider, provider_channel_id, provider_session_id, channel_token, status,
          qr_created_at, qr_expires_at, connected_at, disconnected_at, created_at, updated_at)
       VALUES ($1, $2, 'WHAPI', $3, $4, $5, 'WAITING_FOR_SCAN', $6, $7, NULL, NULL, $6, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         provider_channel_id = EXCLUDED.provider_channel_id,
         provider_session_id = EXCLUDED.provider_session_id,
         channel_token = EXCLUDED.channel_token,
         status = 'WAITING_FOR_SCAN',
         qr_fingerprint = NULL,
         qr_created_at = EXCLUDED.qr_created_at,
         qr_expires_at = EXCLUDED.qr_expires_at,
         phone_masked = NULL,
         account_name = NULL,
         last_polled_at = NULL,
         confirmed_at = NULL,
         connected_at = NULL,
         disconnected_at = NULL,
         updated_at = EXCLUDED.updated_at
       RETURNING ${COLUMNS}`,
      [
        randomUUID(),
        userId,
        params.channelId ?? null,
        sessionId,
        params.channelToken,
        nowIso,
        new Date(now.getTime() + QR_TTL_MS).toISOString(),
      ],
    );
    return row!;
  });
}

/** Records the QR payload fingerprint for the pending attempt. */
export async function attachQrFingerprint(userId: string, fingerprint: string): Promise<void> {
  await query(
    `UPDATE whatsapp_connections SET qr_fingerprint = $2, updated_at = $3
      WHERE user_id = $1 AND status = 'WAITING_FOR_SCAN'`,
    [userId, fingerprint, new Date().toISOString()],
  );
}

export async function setStatus(
  userId: string,
  status: WhatsAppConnectionStatus,
  extra: { message?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `UPDATE whatsapp_connections
        SET status = $2,
            disconnected_at = CASE WHEN $2 IN ('DISCONNECTED', 'CANCELLED', 'EXPIRED') THEN $3 ELSE disconnected_at END,
            updated_at = $3
      WHERE user_id = $1`,
    [userId, status, now],
  );
  void extra;
}

/** Marks the pending attempt EXPIRED, but only while still waiting. */
export async function expireIfStale(userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE whatsapp_connections
        SET status = 'EXPIRED', disconnected_at = $2, updated_at = $2
      WHERE user_id = $1 AND status = 'WAITING_FOR_SCAN'
        AND (qr_expires_at IS NULL OR qr_expires_at <= $2)
      RETURNING id`,
    [userId, new Date().toISOString()],
  );
  return rows.length > 0;
}

/**
 * Promotes a pending attempt to CONNECTED.
 *
 * Two independent guards, both required:
 *   - the row must still be WAITING_FOR_SCAN (a cancelled or expired QR can
 *     never be resurrected by a late provider callback);
 *   - the supplied session id must equal the one this attempt was issued with,
 *     so a scan of an older QR cannot connect a newer pending attempt.
 *
 * Returns false when the guard rejects, which the caller must treat as
 * "ignore this confirmation".
 */
export async function confirmConnection(
  userId: string,
  providerSessionId: string,
  details: { phoneMasked?: string | null; accountName?: string | null; channelId?: string | null },
): Promise<{ ok: boolean; row?: WhatsAppConnectionRow; reason?: string }> {
  const now = new Date().toISOString();
  const row = await queryOne<WhatsAppConnectionRow>(
    `UPDATE whatsapp_connections
        SET status = 'CONNECTED',
            phone_masked = $4,
            account_name = $5,
            provider_channel_id = COALESCE($6, provider_channel_id),
            confirmed_at = $3,
            connected_at = COALESCE(connected_at, $3),
            updated_at = $3
      WHERE user_id = $1
        AND provider_session_id = $2
        AND status = 'WAITING_FOR_SCAN'
        AND (qr_expires_at IS NULL OR qr_expires_at > $3)
      RETURNING ${COLUMNS}`,
    [userId, providerSessionId, now, details.phoneMasked ?? null, details.accountName ?? null, details.channelId ?? null],
  );
  if (!row) return { ok: false, reason: 'no matching pending session' };
  return { ok: true, row };
}

export async function markPolled(userId: string): Promise<void> {
  await query(`UPDATE whatsapp_connections SET last_polled_at = $2 WHERE user_id = $1`, [
    userId,
    new Date().toISOString(),
  ]);
}

/** Clears the row to DISCONNECTED and revokes publish rights. */
export async function disconnect(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `UPDATE whatsapp_connections
        SET status = 'DISCONNECTED',
            disconnected_at = $2,
            updated_at = $2,
            channel_token = NULL,
            provider_session_id = NULL,
            qr_fingerprint = NULL,
            qr_expires_at = NULL
      WHERE user_id = $1`,
    [userId, now],
  );
}

/**
 * Webhook correlation.
 *
 * Resolves an inbound provider event to AT MOST ONE user, by the exact channel
 * id first and then the exact session id. Returns null when the event does not
 * match any pending attempt — an unmatched event must never update a
 * "nearest" or "only" row, because with more than one user that would connect
 * the wrong person.
 */
export async function resolveByProviderRef(params: {
  channelId?: string | null;
  sessionId?: string | null;
}): Promise<WhatsAppConnectionRow | null> {
  if (params.channelId) {
    const byChannel = await queryOne<WhatsAppConnectionRow>(
      `SELECT ${COLUMNS} FROM whatsapp_connections
        WHERE provider_channel_id = $1 AND channel_token IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
      [params.channelId],
    );
    if (byChannel) return byChannel;
  }
  if (params.sessionId) {
    return queryOne<WhatsAppConnectionRow>(
      `SELECT ${COLUMNS} FROM whatsapp_connections
        WHERE provider_session_id = $1 AND channel_token IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
      [params.sessionId],
    );
  }
  return null;
}

/**
 * Finds the SocialPulse account that currently owns a channel, if any.
 *
 * Needed because the deployment runs in SHARED-channel mode: one WHAPI_API_TOKEN
 * points at one Whapi channel, so a second user pressing "Connect" must be told
 * the number is already in use rather than silently taking it over. Matched on
 * the channel token rather than provider_channel_id because that id is only
 * learned from the provider once a pairing completes — during the first pairing
 * the row has no provider_channel_id yet, but it always has the token.
 */
export async function getConnectedOwnerByToken(token: string): Promise<{ user_id: string; phone_masked: string | null } | null> {
  return queryOne<{ user_id: string; phone_masked: string | null }>(
    `SELECT user_id, phone_masked FROM whatsapp_connections
      WHERE channel_token = $1 AND status = 'CONNECTED'
      ORDER BY connected_at DESC NULLS LAST
      LIMIT 1`,
    [token],
  );
}

/** Summary shape for the status endpoint. Never includes channel_token. */
export interface WhatsAppConnectionSummary {
  status: WhatsAppConnectionStatus;
  connected: boolean;
  phoneMasked?: string;
  accountName?: string;
  qrCreatedAt?: string;
  qrExpiresAt?: string;
  providerSessionId?: string;
  lastPolledAt?: string;
  connectedAt?: string;
  message?: string;
}

export function toSummary(row: WhatsAppConnectionRow | null, message?: string): WhatsAppConnectionSummary {
  if (!row) {
    return { status: 'DISCONNECTED', connected: false, message: message || 'WhatsApp is not connected.' };
  }
  return {
    status: row.status,
    // CONNECTED is the ONLY status that maps to connected:true. A pending QR
    // is explicitly not connected, however healthy the channel looks.
    connected: row.status === 'CONNECTED',
    phoneMasked: row.phone_masked || undefined,
    accountName: row.account_name || undefined,
    qrCreatedAt: row.qr_created_at || undefined,
    qrExpiresAt: row.qr_expires_at || undefined,
    providerSessionId: row.provider_session_id || undefined,
    lastPolledAt: row.last_polled_at || undefined,
    connectedAt: row.connected_at || undefined,
    message: message || undefined,
  };
}