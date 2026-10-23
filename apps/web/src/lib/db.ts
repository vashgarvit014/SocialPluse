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
  // AI usage was global; now attributable per account so Superadmin can see
  // who spent what. Nullable on purpose: rows written before this migration
  // (and any row whose actor is not resolvable) stay NULL rather than being
  // backfilled onto an arbitrary user.
  await client.query(`ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_log(user_id, created_at DESC)`);

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

  // Central structured operational log (see src/lib/system-log.ts). Auth/AI
  // history already lives in auth_audit_logs/ai_usage_log and is UNIONed in
  // at read time — this table carries everything else (media, publishing,
  // platform, system). Retention: documented, not automated — no auto-delete
  // runs against this table (see the /superadmin/logs footer).
  await client.query(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR', 'SUCCESS')),
      category TEXT NOT NULL CHECK (category IN ('AUTH', 'USER', 'AI', 'MEDIA', 'PUBLISHING', 'PLATFORM', 'SYSTEM')),
      event TEXT NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT,
      platform TEXT,
      resource_id TEXT,
      message TEXT NOT NULL,
      metadata JSONB,
      request_id TEXT
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_cat_level ON system_logs(category, level)`);

  // Persistent asset library for /asset-gallery direct uploads (see
  // src/lib/media-assets.ts). Unlike session-state mediaItems (React state +
  // drafts) or 24h Instagram staging, rows here survive restarts. Sources
  // are only ever the real origin that wrote the row — never fabricated.
  await client.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('image', 'video')),
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('UPLOAD', 'AI', 'CANVA', 'BRANDED', 'SESSION')),
      storage_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_media_assets_user ON media_assets(user_id, created_at DESC)`);

  // ---------------------------------------------------------------------
  // Media retention + ownership hardening (multi-user isolation work)
  // ---------------------------------------------------------------------
  // user_id stays NULLABLE on purpose. It is not a mistake and it must not be
  // "fixed" with a NOT NULL constraint: rows written before ownership existed
  // have no owner and we cannot prove who created them. Forcing a value here
  // would hand one random user's private media to another. Instead legacy
  // rows keep user_id = NULL and every user-facing query filters on
  // `user_id = $1`, so they are invisible to everyone except Superadmin's
  // explicit cross-user view.
  //
  // source CHECK is widened rather than replaced: 'AI'/'CANVA'/'SESSION' are
  // the values older rows were written with. Dropping them would make those
  // rows un-writable and would fail the ALTER against existing data.
  await client.query(`ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_source_check`);
  await client.query(`
    ALTER TABLE media_assets ADD CONSTRAINT media_assets_source_check CHECK (source IN (
      'UPLOAD', 'AI_GENERATED', 'CANVA_IMPORT', 'BRANDED', 'CAROUSEL', 'OTHER',
      'AI', 'CANVA', 'SESSION'
    ))
  `);

  // original_filename keeps the user's own name; `filename` remains the
  // sanitized display name. They differ once a rename is applied.
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS original_filename TEXT`);
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS width INTEGER`);
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS height INTEGER`);
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS duration_ms INTEGER`);
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS alt_text TEXT`);
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS thumbnail_path TEXT`);
  // Soft delete + retention. deleted_at IS NULL is "still owned by the user";
  // expires_at <= now is "past its 30-day window" and hides it from the
  // gallery without touching the file (the cleanup job owns file removal).
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS deleted_reason TEXT`);
  // storage_path used to hold a bare filename in a flat shared directory. It
  // now holds a user-namespaced relative key (media/{userId}/{bucket}/...).
  // Existing rows keep their old value until they are rewritten; the read
  // path resolves both shapes (see media-assets.ts#resolveWithinRoot).
  await client.query(`UPDATE media_assets SET original_filename = filename WHERE original_filename IS NULL`);
  // Backfill the retention window for pre-existing rows from their own
  // created_at so they expire 30 days after they were made, not 30 days after
  // this migration happened to run.
  await client.query(`
    UPDATE media_assets SET expires_at = created_at + INTERVAL '30 days'
    WHERE expires_at IS NULL AND created_at IS NOT NULL
  `);
  await client.query(`ALTER TABLE media_assets ALTER COLUMN expires_at SET NOT NULL`);
  // The Asset Gallery reads (user_id, active) ordered by recency on every
  // load, and the cleanup job scans (expires_at) where deleted_at IS NULL.
  // Neither composite was covered by the single-column index above.
  await client.query(`CREATE INDEX IF NOT EXISTS idx_media_assets_active ON media_assets(user_id, created_at DESC) WHERE deleted_at IS NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_media_assets_expiry ON media_assets(expires_at) WHERE deleted_at IS NULL`);

  // Scheduled posts / drafts / published history. This replaces the global
  // scheduled-posts.json, which had no owner field at all and was therefore
  // readable and writable by every authenticated user. The full record is
  // kept in `payload` (JSONB) rather than exploded into columns because
  // PostRecord is a wide, actively-evolving editor snapshot — the columns
  // that are queried or filtered on (owner, status, time) are promoted to
  // real indexed columns.
  // id is TEXT, not UUID, on purpose: the pre-ownership JSON file contains
  // Mongo-style ObjectId strings (e.g. "mt6swwrmj73u") alongside UUIDs, and a
  // UUID column made the legacy import abort on the first non-UUID row — which
  // broke draft creation for EVERY user, not just the import. TEXT preserves
  // every existing id verbatim. New posts still use randomUUID(), which is a
  // valid TEXT value.
  await client.query(`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )
  `);
  // Drafts + Scheduler list views: WHERE user_id = $1 ORDER BY created_at.
  await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user ON scheduled_posts(user_id, created_at DESC)`);
  // The publish worker claims due work with status = 'pending' AND
  // scheduled_at <= now across ALL users in one query — without this it
  // table-scans every user's posts on each tick.
  await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON scheduled_posts(scheduled_at) WHERE status = 'pending'`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_status ON scheduled_posts(user_id, status)`);

  // Per-platform rows for a scheduled post. A multi-platform post cannot be
  // reduced to one overall status: LinkedIn succeeding while Instagram is
  // disconnected is a PARTIAL result, and "Retry failed" must be able to
  // re-run exactly one platform without republishing the others.
  //
  // Canonical DDL — services/scheduler-service/src/platform-store.mjs carries
  // the same idempotent statement because scheduler-service owns this table
  // and may boot before the web app does.
  await client.query(`
    CREATE TABLE IF NOT EXISTS scheduled_post_platforms (
      id UUID PRIMARY KEY,
      scheduled_post_id TEXT NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      platform_connection_id UUID,
      destination TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CONNECTION_REQUIRED', 'CANCELLED')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      external_post_id TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (scheduled_post_id, platform)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_spp_user_platform_status ON scheduled_post_platforms(user_id, platform, status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_spp_post ON scheduled_post_platforms(scheduled_post_id)`);

  // Platform OAuth credentials, one row per (app user, provider account).
  // Replaces facebook-tokens.json / linkedin-tokens.json, which were keyed by
  // the PROVIDER's user id and had no app-user association — so any user
  // could reach any other user's stored token, and the "get any" fallback
  // functions handed out the newest entry to whoever asked.
  //
  // `credentials` holds the access/refresh tokens. It never leaves the server
  // on a user-facing route (the browser only receives display metadata), and
  // must never be written to any log.
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_connections (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'linkedin', 'canva')),
      provider_user_id TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      disconnected_at TIMESTAMPTZ
    )
  `);
  // One provider account is connected to exactly one SocialPulse user.
  // Without this a second user could re-run OAuth for the same LinkedIn
  // member id and hijack the first user's connection row.
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_connections_unique ON platform_connections(platform, provider_user_id) WHERE disconnected_at IS NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_connections_user ON platform_connections(user_id, platform) WHERE disconnected_at IS NULL`);

  // Short-lived, user-bound OAuth handshake state (PKCE verifier, pending
  // design, ready design). Replaces canva-sessions.json, whose maps were
  // keyed by state/readyId with no owner — a readyId obtained from a shared
  // browser could pull another user's exported design.
  await client.query(`
    CREATE TABLE IF NOT EXISTS oauth_handshakes (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      state_key TEXT NOT NULL UNIQUE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_oauth_handshakes_expiry ON oauth_handshakes(expires_at)`);

  // One-shot data migrations that cannot be expressed as DDL (e.g. importing
  // the pre-ownership scheduled-posts.json). DDL is idempotent so it re-runs
  // harmlessly on every boot; a one-shot import is NOT, so it records its own
  // completion here instead of inferring "did I already run?" from row counts
  // — a user who legitimately has zero posts must not cause a re-import.
  await client.query(`
    CREATE TABLE IF NOT EXISTS data_migrations (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL,
      details JSONB
    )
  `);

  // ===================================================================
  // WhatsApp (Whapi) connections — one row per USER, bound to the exact
  // provider channel and QR session that user scanned.
  // ===================================================================
  // Before this table, WhatsApp connection state was derived entirely from the
  // shared WHAPI_API_TOKEN env channel: getWhatsAppStatus() probed that one
  // channel's /health and reported CONNECTED to every signed-in user, and a
  // 409 from /users/login/rowdata (meaning "already authenticated, no QR
  // needed") was returned to the caller as CONNECTED. So clicking "Connect"
  // flipped straight to CONNECTED without any scan.
  //
  // channel_token is server-only: it authenticates as that user's channel to
  // Whapi. It is never returned by a user-facing route and never logged.
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_connections (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'WHAPI' CHECK (provider = 'WHAPI'),
      provider_channel_id TEXT,
      provider_session_id TEXT,
      channel_token TEXT,
      status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN (
        'DISCONNECTED', 'CREATING_QR', 'WAITING_FOR_SCAN', 'CONNECTED',
        'EXPIRED', 'ERROR', 'CANCELLED'
      )),
      qr_fingerprint TEXT,
      qr_created_at TIMESTAMPTZ,
      qr_expires_at TIMESTAMPTZ,
      phone_masked TEXT,
      account_name TEXT,
      last_polled_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ,
      disconnected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  // At most one live connection row per user — the status endpoint and the
  // publish path both resolve "this user's channel" with a single lookup.
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conn_user ON whatsapp_connections(user_id)`);
  // Webhook correlation: resolve an inbound provider event to exactly one user.
  // One channel token may back AT MOST ONE connected account.
  //
  // Nothing enforced this before: two rows could both be CONNECTED on the same
  // shared token, and getConnectedOwnerByToken() then resolved ownership to
  // whichever had the later connected_at. That is precisely the failure the
  // ownership gate exists to prevent — two accounts believing they own the same
  // WhatsApp number — so it is enforced at the schema level, not only in code.
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conn_token_owner
       ON whatsapp_connections(channel_token)
     WHERE status = 'CONNECTED' AND channel_token IS NOT NULL`,
  );
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_conn_channel ON whatsapp_connections(provider_channel_id) WHERE provider_channel_id IS NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_conn_session ON whatsapp_connections(provider_session_id) WHERE provider_session_id IS NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_conn_status ON whatsapp_connections(status, qr_expires_at)`);

  // ===================================================================
  // Content moderation
  // ===================================================================
  // Immutable audit trail. prompt_text is deliberately NOT a column: the brief
  // is explicit that raw explicit prompts should not be retained. We keep a
  // salted-free SHA-256 fingerprint so the same request can be recognised as a
  // repeat without storing what was asked for.
  await client.query(`
    CREATE TABLE IF NOT EXISTS moderation_events (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN (
        'ALLOW', 'BLOCK_NUDITY', 'BLOCK_EXPLICIT_SEXUAL', 'BLOCK_OTHER_SAFETY'
      )),
      action TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
      method TEXT NOT NULL,
      provider TEXT,
      counts_as_violation BOOLEAN NOT NULL DEFAULT false,
      violation_count_after INTEGER,
      prompt_fingerprint TEXT,
      safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_moderation_user ON moderation_events(user_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_moderation_created ON moderation_events(created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_moderation_violations ON moderation_events(user_id, created_at DESC) WHERE counts_as_violation`);

  // Pre-existing bug fix (found while testing Content Violation Monitoring):
  // this CHECK only ever allowed 4 of ModerationDecision's 7 real values —
  // BLOCK_SUGGESTIVE, BLOCK_MINOR_SEXUAL and NEEDS_CLARIFICATION were never
  // included, so any AI-generation request landing on one of those three
  // decisions would have failed this INSERT outright. Widened to the full
  // enum (moderation.ts/moderation.mjs's ModerationDecision type).
  await client.query(`ALTER TABLE moderation_events DROP CONSTRAINT IF EXISTS moderation_events_decision_check`);
  await client.query(`
    ALTER TABLE moderation_events ADD CONSTRAINT moderation_events_decision_check CHECK (decision IN (
      'ALLOW', 'BLOCK_NUDITY', 'BLOCK_EXPLICIT_SEXUAL', 'BLOCK_SUGGESTIVE', 'BLOCK_MINOR_SEXUAL', 'NEEDS_CLARIFICATION', 'BLOCK_OTHER_SAFETY'
    ))
  `);

  // Denormalised escalation state on the user so the "is this account
  // flagged" question is a single indexed read on the Superadmin users table
  // rather than a scan over moderation_events.
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_violation_count INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_flagged BOOLEAN NOT NULL DEFAULT false`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_flag_reason TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_flagged_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_first_violation_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_last_violation_at TIMESTAMPTZ`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_users_moderation ON users(moderation_flagged, moderation_violation_count DESC)`);

  // In-app notification queue for Superadmin. This is the notification SYSTEM;
  // the Cloudflare tunnel in front of the app is only transport and plays no
  // part in alerting.
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      is_read BOOLEAN NOT NULL DEFAULT false,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      read_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_notif_unread ON admin_notifications(is_read, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_notif_user ON admin_notifications(user_id, created_at DESC)`);

  // Content Violation Monitoring. Layered ON TOP of moderation_events (which
  // stays exactly as-is — the immutable audit log driving the escalation
  // counter) rather than replacing it: this is the mutable, richer,
  // one-row-per-case record with a status lifecycle, a human reviewer, and
  // source/platform/media context, none of which belongs on an append-only
  // log. Owned by user-service (same owner as moderation_events/
  // admin_notifications/users.moderation_*) so a user's full moderation
  // picture stays in one transactional owner. `decision` is deliberately
  // plain TEXT (not CHECK-constrained) since moderation_events' own
  // decision CHECK is already missing newer ModerationDecision values
  // (BLOCK_SUGGESTIVE/BLOCK_MINOR_SEXUAL/NEEDS_CLARIFICATION) — this table
  // should not duplicate that drift risk.
  await client.query(`
    CREATE TABLE IF NOT EXISTS moderation_incidents (
      id UUID PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('ASSET_GALLERY_UPLOAD', 'AI_GENERATION', 'DIRECT_PUBLISH', 'SCHEDULED_PUBLISH')),
      platform TEXT,
      category TEXT NOT NULL,
      decision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'BLOCKED' CHECK (status IN ('BLOCKED', 'UNCERTAIN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED_FALSE_POSITIVE')),
      confidence TEXT,
      method TEXT NOT NULL,
      content_excerpt_fingerprint TEXT,
      content_preview TEXT,
      media_asset_id UUID,
      media_restricted BOOLEAN NOT NULL DEFAULT false,
      violation_count_after INTEGER,
      warning_notification_id UUID,
      reviewed_by_admin_id UUID REFERENCES users(id),
      reviewed_at TIMESTAMPTZ,
      review_note TEXT,
      safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      deleted_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_incidents_idem ON moderation_incidents(idempotency_key)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mod_incidents_user ON moderation_incidents(user_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mod_incidents_status ON moderation_incidents(status, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mod_incidents_category ON moderation_incidents(category, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mod_incidents_source ON moderation_incidents(source, created_at DESC)`);

  // Durable idempotency + publishing history for publishing-service
  // (services/publishing-service). Previously each provider route kept its
  // own in-memory Map keyed by attemptId — "NOTE: single-instance only; a
  // restart clears the registry" per their own comments. That's fine for a
  // single browser double-click, but not durable enough for
  // scheduler-service (coming next), which must never double-publish across
  // a crash/restart. One row per (platform, attempt_id): a second insert
  // attempt for the same pair is rejected by the unique constraint, which
  // IS the idempotency guarantee — not an application-level check that can
  // race.
  await client.query(`
    CREATE TABLE IF NOT EXISTS publish_attempts (
      id UUID PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      destination TEXT,
      status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
      provider_post_id TEXT,
      error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      UNIQUE (platform, attempt_id)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_publish_attempts_user ON publish_attempts(user_id, created_at DESC)`);

  // scheduler-service (services/scheduler-service) additions to the existing
  // scheduled_posts table — additive ALTER, not a new table (the brief: "do
  // not create duplicate equivalent tables"). The original claim path
  // (src/app/api/scheduler/check/route.ts#POST) has a real TOCTOU race: it
  // reads a row, checks status in JS, then UPDATEs with no status condition
  // in the WHERE clause — two concurrent ticks (e.g. a real cron plus a
  // manual Superadmin "run now") could both pass the JS check before either
  // writes. scheduler-service fixes this with a single atomic
  // UPDATE ... WHERE status = 'pending' ... RETURNING (SELECT FOR UPDATE
  // SKIP LOCKED pattern) — these columns support that, plus bounded
  // retry/backoff for transient provider errors.
  await client.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS locked_by TEXT`);
  await client.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_posts_claim ON scheduled_posts(status, scheduled_at, next_retry_at)`);
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
  verified_at: string | null;
  last_sent_at: string;
  invalidated_at: string | null;
  created_at: string;
}

/**
 * Runs `fn` inside a single transaction and returns its value.
 *
 * Needed wherever a read-modify-write must not interleave with a concurrent
 * request for the same user — the moderation escalation is the motivating
 * case: "read violation count, increment, maybe flag, maybe notify" is four
 * separate effects that must all land or none of them, or two simultaneous
 * violations can both read count=1 and both decide not to flag.
 *
 * `fn` receives a client whose `query` has the same signature as the exported
 * one, so call sites read normally.
 */
export async function withTransaction<T>(fn: (client: TransactionClient) => Promise<T>): Promise<T> {
  await ensureMigrated();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query: async <R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> => {
        const res = await client.query(text, params);
        return res.rows as R[];
      },
      queryOne: async <R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R | null> => {
        const res = await client.query(text, params);
        return (res.rows[0] as R) ?? null;
      },
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch { /* connection already broken; nothing to roll back */ }
    throw err;
  } finally {
    client.release();
  }
}

export interface TransactionClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
}
