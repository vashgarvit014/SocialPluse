import 'server-only';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';

export type AuditEvent =
  | 'OTP_REQUESTED' | 'OTP_DELIVERY_FAILED' | 'OTP_VERIFIED' | 'OTP_FAILED'
  | 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'SIGNUP_SUCCESS' | 'SIGNUP_FAILED'
  | 'PASSWORD_RESET' | 'LOGOUT'
  // Superadmin-initiated account-management events (src/app/api/superadmin/*).
  | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_REACTIVATED' | 'USER_CREATED_BY_ADMIN' | 'RESET_ACCESS_TRIGGERED'
  | 'SESSION_TERMINATED' | 'PUBLISH_RETRIED' | 'PUBLISH_MOVED_TO_DRAFT' | 'COLLAB_INVITE_SENT';

// Safe fields only — never pass otp, password, password hash, session
// secret, or any provider credential into `meta`. Fire-and-forget from
// every call site (not awaited) — an audit-log write must never fail or
// delay the actual auth response; a lost log line is acceptable, a broken
// login because logging hiccuped is not.
export function logAuthEvent(event: AuditEvent, fields: {
  userId?: string;
  channel?: string;
  purpose?: string;
  ip?: string;
  meta?: Record<string, string | number | boolean>;
}): void {
  query(`
    INSERT INTO auth_audit_logs (id, event, user_id, channel, purpose, ip, created_at, meta)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    randomUUID(),
    event,
    fields.userId || null,
    fields.channel || null,
    fields.purpose || null,
    fields.ip || null,
    new Date().toISOString(),
    fields.meta ? JSON.stringify(fields.meta) : null,
  ]).catch((error) => {
    console.error('[audit] failed to write auth event:', error instanceof Error ? error.message : 'unknown error');
  });
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

export interface AuthEventRow {
  id: string;
  event: AuditEvent;
  userId: string | null;
  channel: string | null;
  purpose: string | null;
  ip: string | null;
  createdAt: string;
  meta: Record<string, string | number | boolean> | null;
}

// For the Superadmin "Auth Activity" view only. Rows never contain raw
// OTPs/passwords/hashes/tokens — logAuthEvent() only ever writes the safe
// fields above (see its own doc comment), so reading them back is safe by
// construction; this function does no additional filtering.
export async function listAuthEvents(limit: number): Promise<AuthEventRow[]> {
  const rows = await query<{
    id: string; event: AuditEvent; user_id: string | null; channel: string | null;
    purpose: string | null; ip: string | null; created_at: string; meta: Record<string, string | number | boolean> | null;
  }>('SELECT * FROM auth_audit_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(r => ({ id: r.id, event: r.event, userId: r.user_id, channel: r.channel, purpose: r.purpose, ip: r.ip, createdAt: r.created_at, meta: r.meta }));
}

export interface AuthEventWithUser extends AuthEventRow {
  userName: string | null;
  userEmail: string | null;
}

// Same safety guarantee as listAuthEvents — the LEFT JOIN only adds
// name/email (already-known account fields, not secrets) for display.
export async function listAuthEventsFiltered(params: { search?: string; event?: string; channel?: string; limit: number }): Promise<AuthEventWithUser[]> {
  const clauses: string[] = [];
  const p: unknown[] = [];
  if (params.search) { p.push(`%${params.search}%`); clauses.push(`(u.name ILIKE $${p.length} OR u.email ILIKE $${p.length})`); }
  if (params.event) { p.push(params.event); clauses.push(`a.event = $${p.length}`); }
  if (params.channel) { p.push(params.channel); clauses.push(`a.channel = $${p.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  p.push(params.limit);

  const rows = await query<{
    id: string; event: AuditEvent; user_id: string | null; channel: string | null; purpose: string | null;
    ip: string | null; created_at: string; meta: Record<string, string | number | boolean> | null;
    user_name: string | null; user_email: string | null;
  }>(`
    SELECT a.*, u.name AS user_name, u.email AS user_email
    FROM auth_audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT $${p.length}
  `, p);

  return rows.map(r => ({
    id: r.id, event: r.event, userId: r.user_id, channel: r.channel, purpose: r.purpose, ip: r.ip,
    createdAt: r.created_at, meta: r.meta, userName: r.user_name, userEmail: r.user_email,
  }));
}

export async function listAuthEventsForUser(userId: string, limit: number): Promise<AuthEventRow[]> {
  const rows = await query<{
    id: string; event: AuditEvent; user_id: string | null; channel: string | null;
    purpose: string | null; ip: string | null; created_at: string; meta: Record<string, string | number | boolean> | null;
  }>('SELECT * FROM auth_audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
  return rows.map(r => ({ id: r.id, event: r.event, userId: r.user_id, channel: r.channel, purpose: r.purpose, ip: r.ip, createdAt: r.created_at, meta: r.meta }));
}

// Distinct event names actually seen, for the Auth Activity filter dropdown
// — avoids hardcoding a list that could drift from AuditEvent.
export async function listDistinctAuthEvents(): Promise<string[]> {
  const rows = await query<{ event: string }>('SELECT DISTINCT event FROM auth_audit_logs ORDER BY event ASC');
  return rows.map(r => r.event);
}

// Admin-initiated actions only — same table as Auth Activity (no reason to
// duplicate storage for what's still just "a safe event log"), filtered to
// the events a Superadmin action produces rather than a login/OTP event, so
// the two views stay conceptually distinct like the design reference intended.
const ADMIN_ACTION_EVENTS: AuditEvent[] = [
  'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED', 'USER_CREATED_BY_ADMIN', 'RESET_ACCESS_TRIGGERED',
  'SESSION_TERMINATED', 'PUBLISH_RETRIED', 'PUBLISH_MOVED_TO_DRAFT',
];

export interface AdminAuditRow {
  id: string;
  event: AuditEvent;
  targetUserName: string | null;
  targetUserEmail: string | null;
  createdAt: string;
  meta: Record<string, string | number | boolean> | null;
}

export async function listAdminAuditEvents(params: { search?: string; limit: number }): Promise<AdminAuditRow[]> {
  const clauses = [`a.event = ANY($1)`];
  const p: unknown[] = [ADMIN_ACTION_EVENTS];
  if (params.search) { p.push(`%${params.search}%`); clauses.push(`(u.name ILIKE $${p.length} OR u.email ILIKE $${p.length})`); }
  p.push(params.limit);

  const rows = await query<{
    id: string; event: AuditEvent; created_at: string; meta: Record<string, string | number | boolean> | null;
    user_name: string | null; user_email: string | null;
  }>(`
    SELECT a.id, a.event, a.created_at, a.meta, u.name AS user_name, u.email AS user_email
    FROM auth_audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY a.created_at DESC
    LIMIT $${p.length}
  `, p);

  return rows.map(r => ({ id: r.id, event: r.event, targetUserName: r.user_name, targetUserEmail: r.user_email, createdAt: r.created_at, meta: r.meta }));
}
