#!/usr/bin/env node
/**
 * Idempotent seed for the dedicated Canva App Review account.
 *
 * Safe to re-run: it looks the user up by normalized lowercase email and
 * UPDATEs in place rather than inserting, so repeated runs can never produce
 * a duplicate. It never touches any other user, never grants a role other
 * than the one configured, and never prints the password or the hash.
 *
 * Credentials are read from the environment ONLY — never from source, never
 * from a committed file:
 *
 *   CANVA_REVIEW_NAME      (default "Canva Review")
 *   CANVA_REVIEW_EMAIL     (required)
 *   CANVA_REVIEW_PASSWORD  (required)
 *   CANVA_REVIEW_USER_ID   (optional — pins the id on first INSERT only, so
 *                           it can match the CANVA_REVIEW_USER_ID the
 *                           auth-service is configured with in every
 *                           environment. Ignored on UPDATE: an existing
 *                           row's id never changes. If omitted on insert, a
 *                           random id is generated and printed below — copy
 *                           it into the auth-service's CANVA_REVIEW_USER_ID.)
 *   DATABASE_URL           (required — must point at the PRODUCTION database)
 *
 * Usage:
 *   node infrastructure/scripts/seed-canva-review-user.mjs
 *
 * The password is hashed with the app's own scrypt implementation, so the
 * seeded hash is byte-for-byte the same shape `hashPassword()` produces at
 * signup. Nothing here bypasses, weakens, or otherwise alters authentication.
 *
 * The import below is written to resolve in BOTH layouts: the repository
 * (infrastructure/scripts/ -> ../../services/auth-service/src) and the
 * auth-service container image, which flattens the tree to /app/src.
 */

import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Dynamic (not static) import on purpose: a static import of a missing module
// throws at load time, before any fallback could run. These candidates cover
// the repository layout and the flattened auth-service container image.
const HASH_MODULE_CANDIDATES = [
  './password.mjs',                                                    // container: /app/src/seed-...mjs -> /app/src/password.mjs
  '../../services/auth-service/src/password.mjs',                       // repo: infrastructure/scripts/ -> services/
  '/app/src/password.mjs',                                             // container, when run from elsewhere
];

async function loadHashPassword() {
  for (const candidate of HASH_MODULE_CANDIDATES) {
    try {
      const url = candidate.startsWith('/')
        ? pathToFileURL(candidate).href
        : new URL(candidate, import.meta.url).href;
      if (candidate.startsWith('/') && !existsSync(candidate)) continue;
      const mod = await import(url);
      if (typeof mod.hashPassword === 'function') return mod.hashPassword;
    } catch { /* try the next candidate */ }
  }
  return fail('Could not load the app password hashing module (password.mjs). Refusing to invent a hash.');
}

const REQUIRED = ['CANVA_REVIEW_EMAIL', 'CANVA_REVIEW_PASSWORD', 'DATABASE_URL'];

function fail(message) {
  console.error(`\n  ERROR: ${message}\n`);
  process.exit(1);
}

for (const key of REQUIRED) {
  if (!process.env[key]) {
    fail(`${key} is not set. Pass the value via the environment; do not hardcode it in this file.`);
  }
}

const email = process.env.CANVA_REVIEW_EMAIL.trim().toLowerCase();
const name = (process.env.CANVA_REVIEW_NAME || 'Canva Review').trim();
const password = process.env.CANVA_REVIEW_PASSWORD;

// Minimal shape checks. The app's real rules live in password-rules.ts; this
// only catches an obviously-unusable value before it becomes a locked-out
// account nobody can log into.
if (password.length < 8) fail('Password must be at least 8 characters.');
if (!email.includes('@')) fail(`CANVA_REVIEW_EMAIL is not a valid address: "${email}"`);

if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
  fail('DATABASE_URL is not a PostgreSQL connection string. Refusing to guess which database this is.');
}

const hashPassword = await loadHashPassword();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

try {
  const { rows: existing } = await pool.query(
    `SELECT id, email, role, status FROM users WHERE lower(email) = $1`,
    [email],
  );

  const now = new Date().toISOString();
  // Always re-hash: a fresh salt each run, so this is safe to repeat, and the
  // account ends up guaranteed to match the configured password even if it was
  // previously created by hand with a different one.
  const passwordHash = hashPassword(password);
  let action;

  if (existing.length === 0) {
    const id = process.env.CANVA_REVIEW_USER_ID || randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO users (id, name, email, password_hash, email_verified_at, status, role,
                          session_version, moderation_violation_count, moderation_flagged,
                          moderation_flag_reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'USER', 0, 0, false, NULL, $5, $5)
       RETURNING id`,
      [id, name, email, passwordHash, now],
    );
    action = `created ${rows[0].id}`;
  } else {
    if (existing.length > 1) {
      fail(`Found ${existing.length} rows for ${email}. Resolve the duplicate manually; refusing to guess which to update.`);
    }
    // Reset ONLY this account's review-critical fields. Deliberately does not
    // touch name, mobile, or anything outside the account-state set.
    const { rows } = await pool.query(
      `UPDATE users
          SET password_hash = $2,
              email_verified_at = COALESCE(email_verified_at, $3),
              status = 'ACTIVE',
              role = 'USER',
              moderation_flagged = false,
              moderation_flag_reason = NULL,
              moderation_violation_count = 0,
              must_set_password = false,
              updated_at = $3
        WHERE lower(email) = $1
        RETURNING id`,
      [email, passwordHash, now],
    );
    action = `updated ${rows[0].id} (no insert, no duplicate)`;
  }

  // Read back the resulting state and assert it, so a successful exit actually
  // means the account is usable rather than merely written.
  const { rows: check } = await pool.query(
    `SELECT id, name, email, role, status, email_verified_at IS NOT NULL AS email_verified,
            moderation_flagged, must_set_password,
            password_hash LIKE 'scrypt:%' AS hashed
       FROM users WHERE lower(email) = $1`,
    [email],
  );
  const u = check[0];

  const problems = [];
  if (u.role !== 'USER') problems.push(`role=${u.role}`);
  if (u.status !== 'ACTIVE') problems.push(`status=${u.status}`);
  if (!u.email_verified) problems.push('email not verified');
  if (u.moderation_flagged) problems.push('moderation flagged');
  if (u.must_set_password) problems.push('must_set_password set');
  if (!u.hashed) problems.push('password_hash is not scrypt');

  console.log(`\n  Canva Review account ${action}`);
  console.log(`    id       : ${u.id}`);
  console.log(`    name     : ${u.name}`);
  console.log(`    email    : ${u.email}`);
  console.log(`    role     : ${u.role}`);
  console.log(`    status   : ${u.status}`);
  console.log(`    verified : ${u.email_verified}`);
  console.log(`    password : scrypt hash present (value not printed)`);

  if (problems.length) fail(`Post-write verification failed: ${problems.join(', ')}`);
  console.log(`\n  OK — account is USER / ACTIVE / verified / hashed.`);
  console.log(`  Set CANVA_REVIEW_USER_ID=${u.id} on the auth-service for the OTP exemption to take effect.\n`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await pool.end();
}