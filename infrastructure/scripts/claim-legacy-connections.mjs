#!/usr/bin/env node
/**
 * Claims the pre-ownership OAuth credentials for ONE named account.
 *
 *   node scripts/claim-legacy-connections.mjs <email>
 *
 * WHY THIS IS A MANUAL STEP
 * ------------------------
 * facebook-tokens.json and linkedin-tokens.json were keyed by the PROVIDER's
 * member id and had no association with a SocialPulse account, so they cannot
 * be attributed automatically. The new platform_connections table requires a
 * non-null user_id, and platform_connections has no "unassigned" concept for
 * good reason: a connection with no owner is exactly how one user's token
 * became everyone's default account.
 *
 * So the legacy files are NOT silently adopted by whoever registers next. An
 * operator runs this deliberately, naming the account that legitimately owns
 * them. Until then those credentials stay inert on disk and the owner simply
 * re-runs OAuth — which now binds correctly to whoever starts the flow.
 *
 *   npm run claim-legacy-connections -- owner@example.com
 */

import { Pool, types } from 'pg';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved relative to this file, not process.cwd() — the legacy JSON
// files (facebook-tokens.json, linkedin-tokens.json) live at the repo
// root regardless of where this script is invoked from.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const now = new Date().toISOString();

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/claim-legacy-connections.mjs <account-email>');
  process.exit(1);
}

function readJson(file) {
  const path = join(REPO_ROOT, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.warn(`[claim] ${file} is unreadable (${err.message}) — skipping.`);
    return null;
  }
}

async function main() {
  const user = (await pool.query('SELECT id, email, name FROM users WHERE lower(email) = lower($1)', [email])).rows[0];
  if (!user) {
    console.error(`[claim] No account with email ${email}. Create it first (sign up), then re-run.`);
    process.exit(1);
  }
  console.log(`[claim] Claiming legacy credentials for ${user.email} (${user.id})\n`);

  const fb = readJson('facebook-tokens.json');
  if (fb?.facebook && Object.keys(fb.facebook).length) {
    for (const [providerUserId, entry] of Object.entries(fb.facebook)) {
      if (!entry?.userToken || !Array.isArray(entry.pages) || entry.pages.length === 0) continue;
      await pool.query(
        `INSERT INTO platform_connections
           (id, user_id, platform, provider_user_id, display_name, credentials, meta, created_at, updated_at)
         VALUES ($1,$2,'facebook',$3,$4,$5,$6,$7,$7)
         ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
           DO UPDATE SET user_id = EXCLUDED.user_id, credentials = EXCLUDED.credentials, updated_at = EXCLUDED.updated_at`,
        [
          randomUUID(),
          user.id,
          String(providerUserId),
          entry.pages[0]?.name ?? null,
          JSON.stringify({
            userToken: entry.userToken,
            pages: entry.pages.map((p) => ({
              id: p.id,
              name: p.name,
              accessToken: p.accessToken,
              ...(p.instagramAccountId ? { instagramAccountId: p.instagramAccountId, instagramUsername: p.instagramUsername } : {}),
            })),
          }),
          JSON.stringify({ pageCount: entry.pages.length, legacy: true }),
          now,
        ],
      );
      console.log(`[claim] facebook  provider id ${providerUserId} -> ${entry.pages.length} page(s)`);
    }
  } else {
    console.log('[claim] facebook  nothing to claim');
  }

  const li = readJson('linkedin-tokens.json');
  if (li?.linkedin && Object.keys(li.linkedin).length) {
    for (const [providerUserId, entry] of Object.entries(li.linkedin)) {
      if (!entry?.accessToken) continue;
      await pool.query(
        `INSERT INTO platform_connections
           (id, user_id, platform, provider_user_id, credentials, meta, created_at, updated_at)
         VALUES ($1,$2,'linkedin',$3,$4,$5,$6,$6)
         ON CONFLICT (platform, provider_user_id) WHERE disconnected_at IS NULL
           DO UPDATE SET user_id = EXCLUDED.user_id, credentials = EXCLUDED.credentials, updated_at = EXCLUDED.updated_at`,
        [randomUUID(), user.id, String(providerUserId), JSON.stringify({ accessToken: entry.accessToken }), JSON.stringify({ legacy: true }), now],
      );
      console.log(`[claim] linkedin  provider id ${providerUserId}`);
    }
  } else {
    console.log('[claim] linkedin  nothing to claim');
  }

  // ---- WhatsApp / Whapi deployment channel -------------------------------
  // The shared WHAPI_API_TOKEN channel is not a user's connection. It used to
  // be handed to whoever was signed in, which is why "Connect WhatsApp"
  // reported CONNECTED with no scan. Binding it is therefore an explicit,
  // named-operator action rather than an automatic inheritance.
  const whapiToken = process.env.WHAPI_API_TOKEN?.trim();
  const whapiChannel = process.env.WHAPI_CHANNEL_ID?.trim() || null;
  const whapiBase = (process.env.WHAPI_API_BASE?.trim() || 'https://gate.whapi.cloud').replace(/\/+$/, '');
  if (whapiToken) {
    const now = new Date().toISOString();

    // Never write CONNECTED on the strength of the token alone. The token
    // exists whether or not a phone is actually paired to the channel: an
    // unpaired channel answers /health with status LAUNCH and user:null while
    // still holding a perfectly valid token. Recording that as CONNECTED
    // produced a user who looked connected and could not send anything.
    let authenticated = false;
    let providerStatus = 'unknown';
    let providerPhone = null;
    try {
      const res = await fetch(`${whapiBase}/health`, {
        headers: { Authorization: `Bearer ${whapiToken}` },
      });
      const data = await res.json();
      providerStatus = data?.status?.text || String(res.status);
      providerPhone = data?.user?.phone || null;
      // A linked DEVICE is the signal, not a status code and not a phone.
      // This gateway reports the paired state as status "LAUNCH" (not AUTH)
      // and returns user:{id:…} with NO phone field, while an unpaired
      // channel returns user:null. Requiring phone — or trusting LAUNCH/INIT —
      // gets this exactly backwards in one direction or the other.
      authenticated = !!(data?.user && typeof data.user === 'object');
    } catch (err) {
      console.warn(`[claim] could not reach Whapi to verify the channel (${err.message})`);
    }

    if (!authenticated) {
      console.log(`[claim] whatsapp  channel ${whapiChannel || '(id unknown)'} is NOT paired to a`);
      console.log(`[claim]           WhatsApp account (provider status: ${providerStatus}).`);
      console.log('[claim]           Refusing to record it as CONNECTED — pair it first by');
      console.log('[claim]           scanning a QR for this channel in the Whapi dashboard,');
      console.log('[claim]           then re-run this script.');
      return;
    }

    await pool.query(
      `INSERT INTO whatsapp_connections
         (id, user_id, provider, provider_channel_id, channel_token, status, phone_masked, account_name, connected_at, created_at, updated_at)
       VALUES ($1,$2,'WHAPI',$3,$4,'CONNECTED',$5,$6,$7,$7,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         provider_channel_id = EXCLUDED.provider_channel_id,
         channel_token = EXCLUDED.channel_token,
         status = 'CONNECTED',
         phone_masked = EXCLUDED.phone_masked,
         account_name = EXCLUDED.account_name,
         disconnected_at = NULL,
         updated_at = EXCLUDED.updated_at`,
      [
        randomUUID(),
        user.id,
        whapiChannel,
        whapiToken,
        providerPhone ? `${providerPhone.slice(0, 2)}***${providerPhone.slice(-2)}` : null,
        'Workspace number',
        now,
      ],
    );
    console.log(`[claim] whatsapp channel ${whapiChannel || '(no channel id)'} paired and bound to ${user.email}`);
  } else {
    console.log('[claim] whatsapp  WHAPI_API_TOKEN not set — nothing to claim');
  }

  console.log('\n[claim] Done. The JSON files are left on disk untouched — delete them once');
  console.log('[claim] you have reconnected through OAuth, so there is a single source of truth.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[claim] failed:', err.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});