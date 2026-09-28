import 'server-only';
import { Pool, type PoolClient, types } from 'pg';

// pg's default TIMESTAMPTZ/TIMESTAMP parsing returns JS Date objects; every
// call site in this codebase (otp.ts, users.ts, audit.ts — carried over
// unchanged from the SQLite implementation) treats these fields as ISO
// strings (row.expires_at, row.created_at, etc., typed `string`). Parsing
// them back to strings here keeps that code byte-identical instead of
// threading Date-vs-string handling through every consumer.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value) => value === null ? null : new Date(value).toISOString());
types.setTypeParser(types.builtins.TIMESTAMP, (value) => value === null ? null : new Date(value).toISOString());

// PostgreSQL, reached over the internal Docker network at db:5432 (service
// name "db" — see docker-compose.yml; inside the app container "localhost"
// would mean the app container itself, not the DB container). Connection
// pooling (not a single client) so concurrent requests don't serialize on
// one socket — pg's Pool handles reconnects/backoff internally.
function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Expected postgresql://<user>:<password>@db:5432/<database> — see .env.example.');
  }
  return url;
}

const globalForDb = globalThis as unknown as { __socialpulsePool?: Pool; __socialpulseMigrated?: Promise<void> };

function getPool(): Pool {
  if (globalForDb.__socialpulsePool) return globalForDb.__socialpulsePool;
  const pool = new Pool({ connectionString: getConnectionString() });
  // Never let a pooled client's idle-connection error crash the process —
  // pg emits this on the pool itself, not on the query promise.
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
  globalForDb.__socialpulsePool = pool;
  return pool;
}

async function migrate(client: PoolClient) {
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

  // Additive migration for the Superadmin layer — this table pre-dates
  // roles, so ALTER TABLE (not just widening CREATE TABLE) to avoid
  // clobbering rows that may already exist. Every pre-existing row
  // (created before "role" existed) defaults to 'USER', which is exactly
  // right — nobody becomes SUPERADMIN by accident from a schema change.
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'USER'`);
  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPERADMIN', 'USER'))`);
  // Last successful login — stamped by session.ts#createSession. Powers the
  // Superadmin user table/detail "Last Login" column without needing to
  // scan auth_audit_logs for it on every render.
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`);
  // True only for accounts created via the Superadmin "Create User" flow,
  // which sets an unusable random password_hash (the admin never sets or
  // sees a real password — see users.ts#createAdminManagedUser). Cleared
  // the moment the user sets their own password via the existing
  // password-reset flow (see password/reset/route.ts).
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_set_password BOOLEAN NOT NULL DEFAULT false`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS otp_challenges (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'WHATSAPP')),
      purpose TEXT NOT NULL CHECK (purpose IN ('SIGNUP_VERIFY', 'LOGIN_VERIFY', 'PASSWORD_RESET', 'EMAIL_CHANGE', 'MOBILE_CHANGE')),
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      resend_count INTEGER NOT NULL DEFAULT 0,
      max_resends INTEGER NOT NULL DEFAULT 5,
      last_sent_at TIMESTAMPTZ NOT NULL,
      verified_at TIMESTAMPTZ,
      invalidated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_challenges(user_id)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_start TIMESTAMPTZ NOT NULL
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS auth_audit_logs (
      id UUID PRIMARY KEY,
      event TEXT NOT NULL,
      user_id UUID,
      channel TEXT,
      purpose TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      meta JSONB
    );
  `);

  // Tracked alongside (never instead of) the existing stateless JWT session
  // cookie — see session.ts. A row here is purely for Superadmin visibility
  // ("Active Sessions") and revocation; verifySession() in dal.ts still does
  // its own JWT signature + sessionVersion check first and treats a JWT with
  // no session_id claim (issued before this table existed) as valid — this
  // table is additive, not a replacement for the existing auth mechanism.
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)`);

  // Usage metering for the AI content/image generation routes — did not
  // exist before this table; counts start from whenever this migration
  // first runs, never backfilled. See src/lib/ai-usage.ts.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_log (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('CONTENT', 'IMAGE')),
      provider TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_log(created_at)`);

  // Server-side workspace draft — one row per user, full pixels included.
  // localStorage caps at ~5MB so the client autosave strips images past 4MB
  // (mediaSkipped); this table has no such limit, so "Keep my content" can
  // restore the previous image instead of dropping it. See
  // src/lib/editor-draft.ts.
  await client.query(`
    CREATE TABLE IF NOT EXISTS editor_drafts (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      draft JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
}

// Runs once per process (not once per request) — every route module import
// calls query()/getPool() during Next's page-data-collection at build time
// too, so the migration itself stays lazy (first real query), same as the
// old SQLite getDb(). Concurrent first-callers await the same promise
// instead of racing separate migration runs.
function ensureMigrated(): Promise<void> {
  if (!globalForDb.__socialpulseMigrated) {
    globalForDb.__socialpulseMigrated = (async () => {
      const client = await getPool().connect();
      try {
        await migrate(client);
      } finally {
        client.release();
      }
    })();
  }
  return globalForDb.__socialpulseMigrated;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureMigrated();
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  password_hash: string;
  email_verified_at: string | null;
  mobile_verified_at: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  role: 'SUPERADMIN' | 'USER';
  session_version: number;
  last_login_at: string | null;
  must_set_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface OtpChallengeRow {
  id: string;
  user_id: string;
  destination: string;
  channel: 'EMAIL' | 'WHATSAPP';
  purpose: string;
  otp_hash: string;
  expires_at: string;
  attempt_count: number;
  max_attempts: number;
  resend_count: number;
  max_resends: number;
  last_sent_at: string;
  verified_at: string | null;
  invalidated_at: string | null;
  created_at: string;
}
