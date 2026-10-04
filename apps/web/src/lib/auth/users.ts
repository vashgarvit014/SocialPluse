import 'server-only';
import { randomUUID, randomBytes } from 'node:crypto';
import { query, queryOne, type UserRow } from '@/lib/db';
import { normalizeMobile } from './mobile';
import { hashPassword } from './password';

export type UserRole = 'SUPERADMIN' | 'USER';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface User {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  emailVerifiedAt: string | null;
  mobileVerifiedAt: string | null;
  status: UserStatus;
  role: UserRole;
  sessionVersion: number;
  lastLoginAt: string | null;
  mustSetPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

// Trim + lowercase so "User@Example.com" and "user@example.com" are the same
// account. Applied at every read/write boundary — never store or compare a
// raw, un-normalized email.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toUser(row: UserRow): User {
  return {
    id: row.id, name: row.name, email: row.email, mobile: row.mobile,
    emailVerifiedAt: row.email_verified_at, mobileVerifiedAt: row.mobile_verified_at,
    status: row.status, role: row.role, sessionVersion: row.session_version,
    lastLoginAt: row.last_login_at, mustSetPassword: row.must_set_password,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.password_hash };
}

export async function findUserByMobile(mobile: string): Promise<(User & { passwordHash: string }) | null> {
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE mobile = $1', [normalizeMobile(mobile)]);
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.password_hash };
}

// Login accepts "Email OR Mobile" as one identifier field — try email first
// (cheap, unambiguous), fall back to mobile.
export async function findUserByIdentifier(identifier: string): Promise<(User & { passwordHash: string }) | null> {
  return (await findUserByEmail(identifier)) || (await findUserByMobile(identifier));
}

export async function findUserById(id: string): Promise<User | null> {
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return row ? toUser(row) : null;
}

// Signup creates the row immediately as PENDING — it only becomes ACTIVE
// once SIGNUP_VERIFY OTP succeeds (see otp/verify). Never skip straight to
// ACTIVE from here. `role` is NOT a parameter here on purpose — public
// signup can only ever create role='USER' (the column's own DB default),
// so there's no code path from the signup API that could set anything else
// even if a request body tried to smuggle a role in (the signup schema
// doesn't accept one at all — see schemas.ts).
export async function createPendingUser(name: string, email: string, mobile: string, passwordHash: string): Promise<User> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await query(`
    INSERT INTO users (id, name, email, mobile, password_hash, status, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'PENDING', 'USER', $6, $6)
  `, [id, name.trim(), normalizeEmail(email), normalizeMobile(mobile), passwordHash, now]);
  return {
    id, name: name.trim(), email: normalizeEmail(email), mobile: normalizeMobile(mobile),
    emailVerifiedAt: null, mobileVerifiedAt: null, status: 'PENDING', role: 'USER', sessionVersion: 0,
    lastLoginAt: null, mustSetPassword: false, createdAt: now, updatedAt: now,
  };
}

// Superadmin-only path (see /api/superadmin/users POST) — spec explicitly
// forbids the admin ever setting or seeing a real password, so this row
// gets a cryptographically random, never-surfaced password_hash and
// must_set_password=true. The user can't log in with that unknown password;
// they instead use the existing "Forgot Password" flow on /login-signup
// (identifier-only, no password needed to start it — see
// password/forgot/route.ts) to prove ownership via OTP and set their own
// real password, which also clears must_set_password (see
// password/reset/route.ts) and — since verifying ANY OTP proves channel
// ownership — activates the account if it was still PENDING (see
// otp/verify/route.ts's PASSWORD_RESET branch). Always role='USER': this
// function has no role parameter, matching the spec's "do not allow
// Superadmin to create another SUPERADMIN through the normal UI".
export async function createAdminManagedUser(name: string, email: string, mobile: string): Promise<User> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const unusablePasswordHash = hashPassword(randomBytes(32).toString('hex'));
  await query(`
    INSERT INTO users (id, name, email, mobile, password_hash, status, role, must_set_password, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'PENDING', 'USER', true, $6, $6)
  `, [id, name.trim(), normalizeEmail(email), normalizeMobile(mobile), unusablePasswordHash, now]);
  return {
    id, name: name.trim(), email: normalizeEmail(email), mobile: normalizeMobile(mobile),
    emailVerifiedAt: null, mobileVerifiedAt: null, status: 'PENDING', role: 'USER', sessionVersion: 0,
    lastLoginAt: null, mustSetPassword: true, createdAt: now, updatedAt: now,
  };
}

// Marks the OTP'd channel verified and, if the account was still PENDING,
// activates it. Login-time OTP on an already-ACTIVE user hits the same
// function and just re-stamps the verified timestamp for that channel.
export async function markChannelVerified(userId: string, channel: 'EMAIL' | 'WHATSAPP'): Promise<void> {
  const now = new Date().toISOString();
  const column = channel === 'EMAIL' ? 'email_verified_at' : 'mobile_verified_at';
  await query(
    `UPDATE users SET ${column} = $1, status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END, updated_at = $1 WHERE id = $2`,
    [now, userId],
  );
}

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  const now = new Date().toISOString();
  // Bumping session_version invalidates every JWT issued before this
  // moment (see session.ts#SessionPayload) — this IS "invalidate previous
  // sessions" for a stateless-cookie design with no server-side session store.
  // must_set_password is cleared here too: setting any real password (self-
  // service reset or the mandatory first-password-set for an admin-created
  // account) satisfies it either way — one code path, not two.
  await query(
    'UPDATE users SET password_hash = $1, session_version = session_version + 1, must_set_password = false, updated_at = $2 WHERE id = $3',
    [passwordHash, now, userId],
  );
}

export async function recordLogin(userId: string): Promise<void> {
  await query('UPDATE users SET last_login_at = $1 WHERE id = $2', [new Date().toISOString(), userId]);
}

// Email-change completion (Superadmin settings): swaps the address only
// after OTP success, stamps the new address verified. The users.email UNIQUE
// constraint is the race backstop — a concurrent duplicate surfaces as 23505
// for the caller to translate, so no separate lock is needed.
export async function updateUserEmail(userId: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  await query('UPDATE users SET email = $1, email_verified_at = $2, updated_at = $2 WHERE id = $3', [
    normalizeEmail(email),
    now,
    userId,
  ]);
}

export interface UserListItem {
  id: string; name: string; email: string; mobile: string | null;
  status: UserStatus; role: UserRole; createdAt: string; lastLoginAt: string | null;
}

// Simple LIKE search across name/email/mobile — this is an internal admin
// tool at modest scale, not a public search endpoint; a full-text index
// would be premature here. Capped page size (see route) keeps a worst-case
// unfiltered query cheap regardless.
export async function listUsers(params: { search?: string; status?: UserStatus; limit: number; offset: number }): Promise<{ users: UserListItem[]; total: number }> {
  const searchTerm = params.search?.trim();
  const clauses: string[] = [];
  const queryParams: unknown[] = [];
  if (searchTerm) { queryParams.push(`%${searchTerm}%`); clauses.push(`(name ILIKE $${queryParams.length} OR email ILIKE $${queryParams.length} OR mobile ILIKE $${queryParams.length})`); }
  if (params.status) { queryParams.push(params.status); clauses.push(`status = $${queryParams.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query<UserRow>(
    `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
    [...queryParams, params.limit, params.offset],
  );
  const countRow = await queryOne<{ count: string }>(`SELECT count(*) FROM users ${where}`, queryParams);

  return {
    users: rows.map(r => ({ id: r.id, name: r.name, email: r.email, mobile: r.mobile, status: r.status, role: r.role, createdAt: r.created_at, lastLoginAt: r.last_login_at })),
    total: Number(countRow?.count ?? 0),
  };
}

export interface UserCounts {
  total: number; active: number; pending: number; suspended: number;
}

export async function countUsersByStatus(): Promise<UserCounts> {
  const row = await queryOne<{ total: string; active: string; pending: string; suspended: string }>(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status = 'ACTIVE') AS active,
      count(*) FILTER (WHERE status = 'PENDING') AS pending,
      count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended
    FROM users
  `);
  return {
    total: Number(row?.total ?? 0), active: Number(row?.active ?? 0),
    pending: Number(row?.pending ?? 0), suspended: Number(row?.suspended ?? 0),
  };
}

export async function listRecentSignups(limit: number): Promise<UserListItem[]> {
  const rows = await query<UserRow>('SELECT * FROM users ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(r => ({ id: r.id, name: r.name, email: r.email, mobile: r.mobile, status: r.status, role: r.role, createdAt: r.created_at, lastLoginAt: r.last_login_at }));
}

// Only ACTIVE<->SUSPENDED is a valid admin-initiated transition (matches the
// spec's own diagram) — a PENDING account isn't "suspended" or "reactivated",
// it's still mid-verification, so that's rejected with a clear reason
// rather than silently accepted into a confusing state.
export async function setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await findUserById(userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (user.status === 'PENDING') {
    return { ok: false, error: 'This account has not completed verification yet and cannot be suspended or activated directly.' };
  }
  if (user.status === status) {
    return { ok: false, error: `Account is already ${status.toLowerCase()}.` };
  }
  const now = new Date().toISOString();
  // No explicit session_version bump needed to enforce this immediately —
  // verifySession() (dal.ts) already rejects any session whose user isn't
  // currently ACTIVE on every request, so flipping status here alone kills
  // every existing session for this user on their very next request.
  await query('UPDATE users SET status = $1, updated_at = $2 WHERE id = $3', [status, now, userId]);
  return { ok: true };
}
