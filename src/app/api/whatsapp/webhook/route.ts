import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { join } from 'path';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
// Local, gitignored append-only log of received events - there's no UI to
// view these yet, so this is the inspection point until one exists.
const LOG_FILE = join(process.cwd(), 'whatsapp-events.log');

// Meta's one-time subscription handshake: when you paste the Callback URL
// + Verify Token into App Dashboard > WhatsApp > Configuration and click
// Verify and Save, Meta GETs this URL with these three query params and
// expects the raw hub.challenge value echoed back (as plain text, not JSON)
// if hub.verify_token matches what you configured. Anything else = reject.
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return new NextResponse(challenge || '', { status: 200 });
  }
  return NextResponse.json({ error: 'verification_failed' }, { status: 403 });
}

// Real events land here once subscribed: group_lifecycle_update,
// group_participants_update, group_settings_update, group_status_update,
// plus ordinary inbound "messages" events. Meta expects a fast 200 - do not
// do slow work in this handler; just acknowledge and log for now.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${JSON.stringify(body)}\n`);
  } catch (err) {
    console.error('[whatsapp/webhook] failed to write event log:', err instanceof Error ? err.message : err);
  }
  console.log('[whatsapp/webhook] event received:', JSON.stringify(body).slice(0, 500));

  return NextResponse.json({ received: true });
}
