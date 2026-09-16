import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { join } from 'path';

// Separate Whapi webhook — DO NOT reuse /api/whatsapp/webhook (Meta payloads differ)
// Whapi webhook URL: https://socialpulse.dotstark.tech/api/whapi/webhook
// Handles initially: messages.post, statuses.post
// Logs sanitized metadata only, returns 200 quickly. Extensible for groups/communities.

const LOG_FILE = join(process.cwd(), 'whapi-events.log');

function sanitizePayload(body: unknown): unknown {
  try {
    const raw = JSON.stringify(body);
    if (raw.length > 4000) return JSON.parse(`${raw.slice(0, 4000)}...[truncated]`);
    // Avoid logging large media base64 bodies
    const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : body;
    if (typeof obj === 'object' && obj !== null) {
      const copy: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
      // If message contains base64 media, truncate
      if (typeof copy.body === 'string' && (copy.body as string).length > 500) {
        copy.body = `${(copy.body as string).slice(0, 200)}...[${(copy.body as string).length} chars]`;
      }
      return copy;
    }
    return body;
  } catch {
    return '[unserializable payload]';
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // Extract event type if present for logging
  const eventType = (body as Record<string, unknown>)?.event?.toString() || (body as Record<string, unknown>)?.type?.toString() || 'unknown';
  const chatId = (body as Record<string, unknown>)?.chat_id?.toString() || (body as Record<string, unknown>)?.chatId?.toString() || '';

  try {
    const sanitized = sanitizePayload(body);
    const line = `${new Date().toISOString()} whapi ${eventType} ${chatId ? chatId.slice(0, 12) + '...' : ''} ${JSON.stringify(sanitized).slice(0, 800)}\n`;
    try {
      appendFileSync(LOG_FILE, line);
    } catch (err) {
      console.error('[whapi/webhook] failed to write log:', err instanceof Error ? err.message : err);
    }
    console.log(`[whapi/webhook] ${eventType} received ${chatId ? `chat ${chatId.slice(0, 12)}...` : ''}`);
  } catch {
    console.log('[whapi/webhook] event received');
  }

  // Always 200 quickly — do not do slow work
  return NextResponse.json({ received: true });
}

export async function GET() {
  // Allow health check: GET https://socialpulse.dotstark.tech/api/whapi/webhook should 200
  return NextResponse.json({ ok: true, webhook: 'whapi', events: ['messages.post', 'statuses.post'] });
}
