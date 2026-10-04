// Faithful port of the user-domain (not auth-domain) parts of
// src/lib/auth/users.ts — profile reads, listing, and account-status
// transitions. Deliberately NOT ported: findUserByEmail/findUserByMobile/
// findUserByIdentifier (return passwordHash, login-domain), createPendingUser/
// createAdminManagedUser (signup-domain, write password_hash), markChannelVerified/
// updatePassword/updateUserEmail (auth-domain, bump session_version off a
// verified auth event) — all of that stays in the monolith until
// auth-service exists, per this round's explicit boundary.

function toProfile(row) {
  return {
    id: row.id, name: row.name, email: row.email, mobile: row.mobile,
    emailVerifiedAt: row.email_verified_at, mobileVerifiedAt: row.mobile_verified_at,
    status: row.status, role: row.role, lastLoginAt: row.last_login_at,
    mustSetPassword: row.must_set_password, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createUserStore(pool) {
  return {
    async findUserById(id) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0] ? toProfile(rows[0]) : null;
    },

    // Same LIKE-search shape as users.ts#listUsers — internal admin tool at
    // modest scale, not a public search endpoint.
    async listUsers({ search, status, limit, offset }) {
      const clauses = [];
      const params = [];
      if (search) { params.push(`%${search}%`); clauses.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR mobile ILIKE $${params.length})`); }
      if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

      const { rows } = await pool.query(
        `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      const countRes = await pool.query(`SELECT count(*) FROM users ${where}`, params);
      return {
        users: rows.map(r => ({ id: r.id, name: r.name, email: r.email, mobile: r.mobile, status: r.status, role: r.role, createdAt: r.created_at, lastLoginAt: r.last_login_at })),
        total: Number(countRes.rows[0]?.count ?? 0),
      };
    },

    async countUsersByStatus() {
      const { rows } = await pool.query(`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE status = 'ACTIVE') AS active,
          count(*) FILTER (WHERE status = 'PENDING') AS pending,
          count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended
        FROM users
      `);
      const row = rows[0] || {};
      return { total: Number(row.total ?? 0), active: Number(row.active ?? 0), pending: Number(row.pending ?? 0), suspended: Number(row.suspended ?? 0) };
    },

    // Only ACTIVE<->SUSPENDED, matching users.ts#setUserStatus exactly —
    // a PENDING account isn't "suspended" or "reactivated", it's still
    // mid-verification. No session_version bump here: dal.ts#verifySession
    // already rejects any session whose user isn't currently ACTIVE on
    // every request, so flipping status alone kills every existing session
    // on that user's very next request.
    async setUserStatus(userId, status) {
      const { rows } = await pool.query('SELECT status FROM users WHERE id = $1', [userId]);
      const user = rows[0];
      if (!user) return { ok: false, error: 'User not found.' };
      if (user.status === 'PENDING') {
        return { ok: false, error: 'This account has not completed verification yet and cannot be suspended or activated directly.' };
      }
      if (user.status === status) {
        return { ok: false, error: `Account is already ${status.toLowerCase()}.` };
      }
      const now = new Date().toISOString();
      await pool.query('UPDATE users SET status = $1, updated_at = $2 WHERE id = $3', [status, now, userId]);
      return { ok: true };
    },
  };
}
