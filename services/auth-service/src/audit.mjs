// Faithful port of the write side of src/lib/auth/audit.ts. Safe fields
// only — never password/hash/OTP/session-token/provider-token. Fire-and-
// forget: a lost audit line must never fail or delay the actual auth
// response. Read-side (listAuthEvents/listAuthEventsFiltered/
// listAuthEventsForUser) stays in the monolith's own Superadmin SSR pages —
// same "not yet cut over" precedent as every prior phase.
import { randomUUID } from 'node:crypto';

export function createAuditLogger(pool) {
  return function logAuthEvent(event, fields = {}) {
    pool.query(
      `INSERT INTO auth_audit_logs (id, event, user_id, channel, purpose, ip, created_at, meta) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(), event, fields.userId || null, fields.channel || null, fields.purpose || null,
        fields.ip || null, new Date().toISOString(), fields.meta ? JSON.stringify(fields.meta) : null,
      ],
    ).catch((error) => {
      console.error('[audit] failed to write auth event:', error instanceof Error ? error.message : 'unknown error');
    });
  };
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(',')[0]?.trim() || 'unknown';
}
