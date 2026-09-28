#!/usr/bin/env node
// Secure, one-time creation of the first SUPERADMIN account — the ONLY
// supported way to get a role='SUPERADMIN' row into the database. There is
// deliberately no "Sign up as Superadmin" UI, no Superadmin checkbox
// anywhere in the app, and no API route that accepts a role in its request
// body (see src/lib/auth/users.ts#createPendingUser /
// createAdminManagedUser — both are hardcoded to role='USER', no
// parameter). Run this only from a trusted machine/terminal with direct
// database access (i.e. wherever DATABASE_URL points, typically via
// `docker exec` into the app container, or with the DB port forwarded
// locally for the duration of this command only).
//
// Usage (interactive — prompts for each field, password input is masked):
//   node scripts/create-superadmin.mjs
//
// Usage (non-interactive — for scripted/CI use, e.g. right after a fresh deploy):
//   SUPERADMIN_NAME="Ops Admin" SUPERADMIN_EMAIL=ops@dotstark.tech \
//   SUPERADMIN_MOBILE=+919876543210 SUPERADMIN_PASSWORD='...' \
//   node scripts/create-superadmin.mjs
//
// Deliberately plain .mjs, no TypeScript imports: this repo's validation
// helpers live under src/lib/auth/* as .ts, and this script needs to run
// via plain `node` with zero extra tooling (no ts-node/tsx dependency for
// what should be a rarely-run, always-reliable ops script). The handful of
// pure validation rules below are duplicated from their .ts source with a
// comment pointing at each — keep them in sync if those files change. This
// is the ONLY file in the project that duplicates auth validation logic;
// everywhere else (client + every API route) imports the single shared
// source in src/lib/auth/schemas.ts.

import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import readline from 'node:readline';
import pg from 'pg';

// --- Duplicated from src/lib/auth/format-rules.ts#isValidName ---
const NAME_TOKEN_RE = /^\p{L}+(?:['-]\p{L}+)*\.?$/u;
function isValidName(name) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  const tokens = trimmed.split(/\s+/);
  return tokens.length > 0 && tokens.every(t => NAME_TOKEN_RE.test(t));
}

// --- Duplicated from src/lib/auth/format-rules.ts#isValidEmailFormat ---
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function isValidEmailFormat(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

// --- Duplicated from src/lib/auth/mobile.ts ---
const E164_RE = /^\+[1-9]\d{7,14}$/;
function normalizeMobile(input) {
  const stripped = input.trim().replace(/[\s\-().]/g, '');
  return stripped.startsWith('00') ? `+${stripped.slice(2)}` : stripped;
}
function isValidMobile(input) {
  return E164_RE.test(normalizeMobile(input));
}

// --- Duplicated from src/lib/auth/password-rules.ts ---
const PASSWORD_REQUIREMENTS_MESSAGE = 'Password must contain at least 8 characters, including uppercase, lowercase, number, and special character.';
function isPasswordValid(pw) {
  return pw.length >= 8 && pw.length <= 128 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// MUST exactly match src/lib/auth/password.ts#hashPassword's output format
// ("scrypt:<saltHex>:<hashHex>") so a superadmin created here can log in
// through the normal /api/auth/login -> verifyPassword() path like any
// other account.
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

// Minimal masked-password prompt (echoes '*' per keystroke, never the real
// character) — Node has no built-in secure prompt. Falls back to a plain
// (visible) prompt when stdin isn't a TTY (e.g. certain piped/CI setups),
// since raw mode requires an interactive terminal.
function promptPassword(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { prompt(question).then(resolve); return; }
    process.stdout.write(question);
    let input = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '') { // Ctrl+C
        process.stdout.write('\n');
        process.exit(130);
      } else if (char === '' || char === '\b') { // backspace
        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        input += char;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

async function migrateUsersTable(client) {
  // Mirrors (just the users-table portion of) src/lib/db.ts#migrate — kept
  // separate rather than imported, since db.ts is 'server-only' (see
  // header comment). Safe to run even if the app has already migrated:
  // every statement is idempotent (IF NOT EXISTS / DROP+ADD CONSTRAINT).
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      mobile TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified_at TIMESTAMPTZ,
      mobile_verified_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'USER'`);
  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPERADMIN', 'USER'))`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_set_password BOOLEAN NOT NULL DEFAULT false`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Run this with the same DATABASE_URL the app uses (see .env.local / docker-compose.yml).');
    process.exit(1);
  }

  const name = process.env.SUPERADMIN_NAME || await prompt('Full name: ');
  if (!isValidName(name)) { console.error('Please enter a valid name.'); process.exit(1); }

  const emailRaw = process.env.SUPERADMIN_EMAIL || await prompt('Email: ');
  const email = normalizeEmail(emailRaw);
  if (!isValidEmailFormat(email)) { console.error('Please enter a valid email address.'); process.exit(1); }

  const mobileRaw = process.env.SUPERADMIN_MOBILE ?? await prompt('Mobile (E.164, e.g. +919876543210 — leave blank to skip WhatsApp OTP): ');
  let mobile = null;
  if (mobileRaw.trim()) {
    mobile = normalizeMobile(mobileRaw);
    if (!isValidMobile(mobile)) { console.error('Please enter a valid mobile number with country code, or leave it blank.'); process.exit(1); }
  }

  const password = process.env.SUPERADMIN_PASSWORD || await promptPassword('Password: ');
  if (!isPasswordValid(password)) { console.error(PASSWORD_REQUIREMENTS_MESSAGE); process.exit(1); }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await migrateUsersTable(client);

    const existing = await client.query('SELECT id, role FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.error(`An account with this email already exists (role: ${existing.rows[0].role}). This script only creates new accounts.`);
      process.exit(1);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    // Created directly ACTIVE + both channels pre-verified: this is a
    // controlled internal process (per spec section 15), not public
    // signup, so there's no need to route it through the normal OTP-gated
    // activation flow just to prove ownership of contact details someone
    // is entering about themselves, interactively, at a trusted terminal.
    // Logging in still always requires OTP (see login/route.ts + otp/
    // verify/route.ts) — this only skips the one-time *account creation*
    // verification step, never the per-login one.
    await client.query(`
      INSERT INTO users (id, name, email, mobile, password_hash, status, role, email_verified_at, mobile_verified_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SUPERADMIN', $6, $7, $6, $6)
    `, [id, name.trim(), email, mobile, hashPassword(password), now, mobile ? now : null]);

    console.log(`\nSuperadmin account created: ${email}${mobile ? ` / ${mobile}` : ''}`);
    console.log('They can now log in at /login-signup — OTP verification is still required on every login, same as any account.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to create Superadmin:', err.message);
  process.exit(1);
});
