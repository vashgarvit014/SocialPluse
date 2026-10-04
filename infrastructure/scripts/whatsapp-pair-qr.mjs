#!/usr/bin/env node
/**
 * Mints a fresh WhatsApp pairing QR for the deployment's Whapi channel.
 *
 *   npm run whatsapp:pair-qr
 *
 * WHY A SCRIPT
 * -------------
 * The QR from GET /users/login?method=qr expires in well under a minute, so
 * it cannot be generated once and left around to be scanned later. Re-run this
 * to get a new code; the previous one is simply replaced.
 *
 * This only initiates a login session on the channel the WHAPI_API_TOKEN
 * already belongs to. It creates no channel and needs no partner API key —
 * pairing is what makes the EXISTING channel usable, it does not grant access
 * to any other channel.
 *
 * Once the phone scans it, verify the channel is genuinely paired and bind it
 * to an account:
 *   npm run claim-legacy-connections -- owner@example.com
 */

import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const base = (process.env.WHAPI_API_BASE?.trim() || 'https://gate.whapi.cloud').replace(/\/+$/, '');
const token = process.env.WHAPI_API_TOKEN?.trim();
const out = process.argv[2] || 'whatsapp-pairing-qr.png';

if (!token) {
  console.error('WHAPI_API_TOKEN is not set. Add it to .env.local (or export it) and retry.');
  process.exit(1);
}

const res = await fetch(`${base}/users/login?method=qr`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.json().catch(() => ({}));

if (!res.ok || body?.error) {
  console.error(`Could not start a login session (HTTP ${res.status}): ${JSON.stringify(body?.error || body)}`);
  process.exit(1);
}

// This gate returns the image in `base64`; some builds use `qr` instead.
const raw = body.base64 || body.qr || body.qrCode;
if (typeof raw !== 'string' || !raw.includes('base64,')) {
  console.error(`Unexpected response shape: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}

const png = Buffer.from(raw.split('base64,')[1], 'base64');
writeFileSync(out, png);

console.log(`QR written to ${out}`);
console.log(`Status: ${body.status} (${body.type}) — expires in ~${body.expire ?? '?'}s`);
console.log('\nOn the phone: WhatsApp → Settings → Linked Devices → Link a Device,');
console.log('then scan the code NOW. If it has expired, run this again for a fresh one.');
console.log('\nAfter a successful scan, confirm and bind it:');
console.log('  npm run claim-legacy-connections -- owner@example.com');

// The validity window is shorter than it takes to read any of the above, so
// pop the image open immediately rather than making the user find the file.
if (process.env.WHATSAPP_PAIR_NO_OPEN !== '1') {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(opener, [out], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.log(`(could not auto-open ${out} — open it manually)`);
  }
}