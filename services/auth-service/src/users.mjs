// Faithful port of the auth-domain parts of src/lib/auth/users.ts — this is
// a DIFFERENT repository boundary than user-service's users.mjs (which owns
// profile/moderation reads): same `users` table, no row duplication, split
// by file/concern per the brief's DB OWNERSHIP section. This file owns
// password_hash reads, signup creation, verification-driven status/email
// transitions, and session_version bumps. NOT ported: createAdminManagedUser
// (dead code — grep confirms it has zero real callers, only comments
// referencing it; the one route that could call it, POST /api/superadmin/
// users, returns a hardcoded 410 instead) and listUsers/countUsersByStatus/
// setUserStatus (user-service's domain, no duplication needed here).
import { randomUUID } from 'node:crypto';

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function toUser(row) {
  return {
    id: row.id, name: row.name, email: row.email, mobile: row.mobile,
    emailVerifiedAt: row.email_verified_at, mobileVerifiedAt: row.mobile_verified_at,
    status: row.status, role: row.role, sessionVersion: row.session_version,
    lastLoginAt: row.last_login_at, mustSetPassword: row.must_set_password,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createUsersRepo(pool) {
  return {
    async findUserByEmail(email) {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
      return rows[0] ? { ...toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
    },
    async findUserByMobile(mobile) {
      const { normalizeMobile } = await import('./mobile.mjs');
      const { rows } = await pool.query('SELECT * FROM users WHERE mobile = $1', [normalizeMobile(mobile)]);
      return rows[0] ? { ...toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
    },
    async findUserByIdentifier(identifier) {
      return (await this.findUserByEmail(identifier)) || (await this.findUserByMobile(identifier));
    },
    async findUserById(id) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0] ? toUser(rows[0]) : null;
    },

    // Signup creates the row PENDING — only becomes ACTIVE once SIGNUP_VERIFY
    // OTP succeeds. `role` is not a parameter — public signup can only ever
    // create role='USER' (the column's own DB default).
    async createPendingUser(name, email, mobile, passwordHash) {
      const { normalizeMobile } = await import('./mobile.mjs');
      const id = randomUUID();
      const now = new Date().toISOString();
      await pool.query(`
        INSERT INTO users (id, name, email, mobile, password_hash, status, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'PENDING', 'USER', $6, $6)
      `, [id, name.trim(), normalizeEmail(email), normalizeMobile(mobile), passwordHash, now]);
      return {
        id, name: name.trim(), email: normalizeEmail(email), mobile: normalizeMobile(mobile),
        emailVerifiedAt: null, mobileVerifiedAt: null, status: 'PENDING', role: 'USER', sessionVersion: 0,
        lastLoginAt: null, mustSetPassword: false, createdAt: now, updatedAt: now,
      };
    },

    // Marks the OTP'd channel verified and, if the account was still
    // PENDING, activates it.
    async markChannelVerified(userId, channel) {
      const now = new Date().toISOString();
      const column = channel === 'EMAIL' ? 'email_verified_at' : 'mobile_verified_at';
      await pool.query(
        `UPDATE users SET ${column} = $1, status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END, updated_at = $1 WHERE id = $2`,
        [now, userId],
      );
    },

    // Bumping session_version invalidates every JWT issued before this
    // moment — this IS "invalidate previous sessions" for a stateless-cookie
    // design with no server-side session store.
    async updatePassword(userId, passwordHash) {
      const now = new Date().toISOString();
      await pool.query(
        'UPDATE users SET password_hash = $1, session_version = session_version + 1, must_set_password = false, updated_at = $2 WHERE id = $3',
        [passwordHash, now, userId],
      );
    },

    async recordLogin(userId) {
      await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [new Date().toISOString(), userId]);
    },

    // Email-change completion: swaps the address only after OTP success. The
    // UNIQUE constraint is the race backstop — a concurrent duplicate
    // surfaces as 23505 for the caller to translate.
    async updateUserEmail(userId, email) {
      const now = new Date().toISOString();
      await pool.query('UPDATE users SET email = $1, email_verified_at = $2, updated_at = $2 WHERE id = $3', [normalizeEmail(email), now, userId]);
    },
  };
}
