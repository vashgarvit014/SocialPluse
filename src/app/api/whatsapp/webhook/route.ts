import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { confirmConnection, resolveByProviderRef } from '@/lib/whatsapp-connections';
import { maskPhone } from '@/app/api/whapi/client';
import { logSystem } from '@/lib/system-log';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';
// Local, gitignored append-only log of received events.
const LOG_FILE = join(process.cwd(), 'whatsapp-events.log');

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meta signs the raw body with X-Hub-Signature-256. Verified against the RAW
 * text: re-serialising the parsed JSON can change byte-for-byte and would make
 * every legitimate event fail the check.
 *
 * Skipped when APP_SECRET is unset so a local dev setup without Meta
 * credentials still works, but that means POSTs are UNVERIFIED in that mode —
 * which is why the handler below still never trusts an unmatched event.
 */
function verifySignature(rawBody: string, header: string | null): boolean {
  if (!APP_SECRET) return true;
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return safeEqual(expected, header);
}

// Meta's one-time subscription handshake.
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && VERIFY_TOKEN && safeEqual(token, VERIFY_TOKEN)) {
    return new NextResponse(challenge || '', { status: 200 });
  }
  return NextResponse.json({ error: 'verification_failed' }, { status: 403 });
}

/** Pulls a channel/session identifier and any auth signal out of the payload. */
function extractEvent(payload: Record<string, unknown>): { channelId?: string; sessionId?: string; authenticated: boolean; phone?: string; accountName?: string } {
  const out: { channelId?: string; sessionId?: string; authenticated: boolean; phone?: string; accountName?: string } = { authenticated: false };
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries as Array<Record<string, unknown>>) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes as Array<Record<string, unknown>>) {
      const value = (change?.value || {}) as Record<string, unknown>;
      const user = (value.user || {}) as { phone?: string; name?: string; pushname?: string };
      const phone = (value.phone_number as string) || user.phone;
      if (phone) {
        out.authenticated = true;
        out.phone = phone;
        out.accountName = user.pushname || user.name;
      }
      const channelId = (value.channel_id as string) || (value.phone_number as string) || undefined;
      if (channelId && !out.channelId) out.channelId = channelId;
      const sessionId = (value.session_id as string) || (value.login_session as string) || undefined;
      if (sessionId && !out.sessionId) out.sessionId = sessionId;
    }
  }
  return out;
}

/**
 * Real events land here: group_lifecycle_update, group_participants_update,
 * inbound "messages", and session/auth notifications.
 *
 * The correlation rule is the important part: an event is matched to AT MOST
 * ONE user by the exact provider channel id (then exact session id), and only
 * that user's row is updated. There is deliberately no "update the most recent
 * pending row" fallback — with more than one user pairing at once, that is
 * exactly how the wrong account gets connected.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    logSystem({
      level: 'WARN', category: 'PLATFORM', event: 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID',
      message: 'Rejected WhatsApp webhook with an invalid signature',
    });
    return NextResponse.json({ received: false, error: 'invalid_signature' }, { status: 403 });
  }

  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`);
  } catch (err) {
    console.error('[whatsapp/webhook] failed to write event log:', err instanceof Error ? err.message : err);
  }

  const event = extractEvent(payload);
  if (event.authenticated) {
    const match = await resolveByProviderRef({ channelId: event.channelId, sessionId: event.sessionId });
    if (!match) {
      // Unmatched is the safe outcome: log it and move on. Connecting a
      // "nearest" row here would hand one user's scan to another account.
      logSystem({
        level: 'WARN', category: 'PLATFORM', event: 'WHATSAPP_WEBHOOK_UNMATCHED',
        platform: 'whatsapp', message: 'WhatsApp auth event did not match any known channel; ignored',
      });
      return NextResponse.json({ received: true, matched: false });
    }

    // confirmConnection re-checks that the row is still WAITING_FOR_SCAN and
    // that the session id matches, so a late webhook for a cancelled or
    // already-expired QR cannot revive it.
    const result = await confirmConnection(match.user_id, match.provider_session_id || '', {
      phoneMasked: event.phone ? maskPhone(event.phone) : null,
      accountName: event.accountName || null,
      channelId: event.channelId || null,
    });
    if (result.ok) {
      logSystem({
        level: 'SUCCESS', category: 'PLATFORM', event: 'WHATSAPP_CONNECTED',
        userId: match.user_id, platform: 'whatsapp', resourceId: match.provider_session_id ?? undefined,
        message: 'WhatsApp connected via webhook confirmation',
        metadata: { accountName: event.accountName ?? null },
      });
      return NextResponse.json({ received: true, matched: true, connected: true });
    }
    return NextResponse.json({ received: true, matched: true, connected: false });
  }

  return NextResponse.json({ received: true });
}