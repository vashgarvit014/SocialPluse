#!/usr/bin/env node
// One-time migration: legacy SQLite auth data (from before this project's
// PostgreSQL migration) -> PostgreSQL.
//
// NOT run automatically by anything — this project's live deployment had
// no real user data in SQLite at the time PostgreSQL was introduced (the
// bind-mounted socialpulse.db had become an empty stray directory, not a
// database), so there was nothing to migrate. This script exists as a
// documented safety net in case an OLD socialpulse.db backup ever surfaces
// and needs importing.
//
// Usage:
//   DATABASE_URL=postgresql://socialpulse_app:...@localhost:5432/socialpulse \
//     node scripts/migrate-sqlite-to-postgres.mjs /path/to/old-socialpulse.db
//
// Safe by design:
//   - Read-only against the SQLite file (never writes/deletes it).
//   - Uses INSERT ... ON CONFLICT DO NOTHING against Postgres, so re-running
//     is a no-op for rows already migrated — never overwrites/duplicates.
//   - Does not touch rate_limit_counters (ephemeral, fine to lose) or
//     auth_audit_logs (historical log — copy manually if you want it; left
//     out here to keep this script focused on the data that actually
//     matters: users and any still-live otp_challenges).
//   - Prints counts only — never logs password_hash/otp_hash values.

import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const sqlitePath = process.argv[2];
if (!sqlitePath) {
  console.error('Usage: node scripts/migrate-sqlite-to-postgres.mjs /path/to/old-socialpulse.db');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const users = sqlite.prepare('SELECT * FROM users').all();
  console.log(`Found ${users.length} user(s) in SQLite.`);

  let usersInserted = 0;
  for (const u of users) {
    const res = await pool.query(
      `INSERT INTO users (id, name, email, mobile, password_hash, email_verified_at, mobile_verified_at, status, session_version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.email, u.mobile, u.password_hash, u.email_verified_at, u.mobile_verified_at, u.status, u.session_version, u.created_at, u.updated_at],
    );
    usersInserted += res.rowCount;
  }
  console.log(`Inserted ${usersInserted} new user row(s) (skipped ${users.length - usersInserted} already-present).`);

  // Only still-unexpired, unverified/uninvalidated challenges are worth
  // carrying over — anything else is stale by definition.
  const challenges = sqlite.prepare(
    `SELECT * FROM otp_challenges WHERE verified_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`,
  ).all(new Date().toISOString());
  console.log(`Found ${challenges.length} still-live OTP challenge(s) in SQLite.`);

  let challengesInserted = 0;
  for (const c of challenges) {
    const res = await pool.query(
      `INSERT INTO otp_challenges (id, user_id, destination, channel, purpose, otp_hash, expires_at, attempt_count, max_attempts, resend_count, max_resends, last_sent_at, verified_at, invalidated_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.user_id, c.destination, c.channel, c.purpose, c.otp_hash, c.expires_at, c.attempt_count, c.max_attempts, c.resend_count, c.max_resends, c.last_sent_at, c.verified_at, c.invalidated_at, c.created_at],
    );
    challengesInserted += res.rowCount;
  }
  console.log(`Inserted ${challengesInserted} new OTP challenge row(s).`);

  console.log('\nDone. The original SQLite file was not modified — verify the counts above look right before deleting it.');
  await pool.end();
  sqlite.close();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
