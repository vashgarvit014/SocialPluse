// Faithful port of src/lib/whatsapp-connections.ts — same table
// (whatsapp_connections, migrated/owned by the monolith at startup; this
// service only reads/writes it, same shared Postgres). Same three-state
// model: WHAPI_PROVIDER_AVAILABLE / WHAPI_CHANNEL_AUTHENTICATED /
// CURRENT_USER_WHATSAPP_CONNECTED — only the last one is ever "Connected".

import { createHash, randomUUID } from 'node:crypto';

const COLUMNS =
  'id, user_id, provider, provider_channel_id, provider_session_id, channel_token, status, ' +
  'qr_fingerprint, qr_created_at, qr_expires_at, phone_masked, account_name, last_polled_at, ' +
  'confirmed_at, connected_at, disconnected_at, created_at, updated_at';

export const QR_TTL_MS = 5 * 60 * 1000;

export function fingerprintQr(rowdata) {
  return createHash('sha256').update(rowdata).digest('hex').slice(0, 32);
}

function newSessionId() {
  return `waseq_${randomUUID()}`;
}

export function createConnectionsStore(pool) {
  async function queryOne(sql, params) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  return {
    async getConnectionByUser(userId) {
      return queryOne(`SELECT ${COLUMNS} FROM whatsapp_connections WHERE user_id = $1`, [userId]);
    },

    async getConnectedChannel(userId) {
      const row = await queryOne(
        `SELECT channel_token, provider_channel_id FROM whatsapp_connections
          WHERE user_id = $1 AND status = 'CONNECTED' AND channel_token IS NOT NULL`,
        [userId],
      );
      if (!row?.channel_token) return null;
      return { token: row.channel_token, channelId: row.provider_channel_id || undefined };
    },

    async beginQrAttempt(userId, params) {
      const now = new Date();
      const nowIso = now.toISOString();
      const sessionId = newSessionId();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
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
          [randomUUID(), userId, params.channelId ?? null, sessionId, params.channelToken, nowIso, new Date(now.getTime() + QR_TTL_MS).toISOString()],
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async attachQrFingerprint(userId, fingerprint) {
      await pool.query(
        `UPDATE whatsapp_connections SET qr_fingerprint = $2, updated_at = $3 WHERE user_id = $1 AND status = 'WAITING_FOR_SCAN'`,
        [userId, fingerprint, new Date().toISOString()],
      );
    },

    async setStatus(userId, status) {
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE whatsapp_connections SET status = $2,
            disconnected_at = CASE WHEN $2 IN ('DISCONNECTED', 'CANCELLED', 'EXPIRED') THEN $3 ELSE disconnected_at END,
            updated_at = $3 WHERE user_id = $1`,
        [userId, status, now],
      );
    },

    async expireIfStale(userId) {
      const { rows } = await pool.query(
        `UPDATE whatsapp_connections SET status = 'EXPIRED', disconnected_at = $2, updated_at = $2
          WHERE user_id = $1 AND status = 'WAITING_FOR_SCAN' AND (qr_expires_at IS NULL OR qr_expires_at <= $2) RETURNING id`,
        [userId, new Date().toISOString()],
      );
      return rows.length > 0;
    },

    async confirmConnection(userId, providerSessionId, details) {
      const now = new Date().toISOString();
      const row = await queryOne(
        `UPDATE whatsapp_connections SET status = 'CONNECTED', phone_masked = $4, account_name = $5,
            provider_channel_id = COALESCE($6, provider_channel_id), confirmed_at = $3,
            connected_at = COALESCE(connected_at, $3), updated_at = $3
          WHERE user_id = $1 AND provider_session_id = $2 AND status = 'WAITING_FOR_SCAN'
            AND (qr_expires_at IS NULL OR qr_expires_at > $3)
          RETURNING ${COLUMNS}`,
        [userId, providerSessionId, now, details.phoneMasked ?? null, details.accountName ?? null, details.channelId ?? null],
      );
      if (!row) return { ok: false, reason: 'no matching pending session' };
      return { ok: true, row };
    },

    async markPolled(userId) {
      await pool.query(`UPDATE whatsapp_connections SET last_polled_at = $2 WHERE user_id = $1`, [userId, new Date().toISOString()]);
    },

    async disconnect(userId) {
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE whatsapp_connections SET status = 'DISCONNECTED', disconnected_at = $2, updated_at = $2,
            channel_token = NULL, provider_session_id = NULL, qr_fingerprint = NULL, qr_expires_at = NULL
          WHERE user_id = $1`,
        [userId, now],
      );
    },

    async getConnectedOwnerByToken(token) {
      return queryOne(
        `SELECT w.user_id, w.phone_masked, u.email AS owner_email
           FROM whatsapp_connections w LEFT JOIN users u ON u.id = w.user_id
          WHERE w.channel_token = $1 AND w.status = 'CONNECTED'
          ORDER BY w.connected_at DESC NULLS LAST LIMIT 1`,
        [token],
      );
    },

    async checkChannelOwnership(userId, token) {
      const owner = await this.getConnectedOwnerByToken(token);
      if (!owner) return { ok: false, code: 'WHATSAPP_CHANNEL_UNCLAIMED' };
      if (owner.user_id !== userId) return { ok: false, code: 'WHATSAPP_NOT_CHANNEL_OWNER', ownerUserId: owner.user_id };
      return { ok: true, ownerUserId: owner.user_id };
    },
  };
}

export function toSummary(row, message) {
  if (!row) return { status: 'DISCONNECTED', connected: false, message: message || 'WhatsApp is not connected.' };
  return {
    status: row.status,
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
