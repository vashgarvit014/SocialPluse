import { NextResponse } from 'next/server';
import { getWhapiConfig, whapiFetch, whapiError, maskPhone } from '../client';
import { requireApiSession } from '@/lib/auth/api';

// GET /api/whapi/status — separate from Meta /api/whatsapp/status
// Calls Whapi /health to verify channel is connected.
// Never exposes token.

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const config = getWhapiConfig();
  if (!config) {
    return NextResponse.json({ connected: false, reason: 'NOT_CONFIGURED', message: 'Whapi is not configured. Add WHAPI_API_TOKEN to .env.local.' });
  }

  try {
    // Whapi health endpoint: GET https://gate.whapi.cloud/health
    // Returns { status: { text: "..." }, user: { phone, name, pushname }, channel_id, uptime ... }
    const res = await whapiFetch('/health', config.token, { method: 'GET' }, config.baseUrl);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const mapped = whapiError(res.status, body, 'health check');
      // Map to required reason codes
      if (res.status === 401) {
        return NextResponse.json({ connected: false, reason: 'UNAUTHORIZED', message: mapped.message, code: mapped.code });
      }
      return NextResponse.json({ connected: false, reason: 'NOT_CONNECTED', message: mapped.message, code: mapped.code, status: res.status });
    }

    const data = await res.json().catch(() => ({})) as {
      status?: { text?: string; code?: number };
      user?: { id?: string | number; phone?: string; name?: string; pushname?: string } | null;
      channel_id?: string;
      uptime?: number;
    };

    const statusText = data.status?.text || 'UNKNOWN';
    // Connected means a WhatsApp ACCOUNT is linked to this channel.
    //
    // LAUNCH and INIT are pre-login states: /health reports them together with
    // user:null on a channel that is not paired yet. Counting them as
    // "connected" made this endpoint report a usable number for a channel
    // that could not send anything, to whichever user happened to call it.
    // user.phone is only ever present once pairing has succeeded.
    // See probeChannel in whatsapp-service.ts: this gateway returns
    // user:{id:…} with NO phone field once a device is linked, and labels the
    // paired state LAUNCH rather than AUTH. Object presence is the discriminator.
    const isConnected = !!data.user?.id || !!data.user?.phone;

    if (!isConnected) {
      return NextResponse.json({
        connected: false,
        reason: 'NOT_CONNECTED',
        channelStatus: statusText,
        message: `Whapi channel status: ${statusText}`,
      });
    }

    const rawPhone = data.user?.phone || '';
    return NextResponse.json({
      connected: true,
      channelStatus: statusText,
      phoneNumberMasked: rawPhone ? maskPhone(rawPhone) : undefined,
      phoneNumber: rawPhone || undefined, // raw for debugging but masked is preferred for UI; raw is phone not token
      accountName: data.user?.pushname || data.user?.name || '',
      channelId: data.channel_id || undefined,
      uptime: typeof data.uptime === 'number' ? data.uptime : undefined,
    });
  } catch (e) {
    console.error('[whapi/status] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ connected: false, reason: 'NETWORK_ERROR', message: 'Network error checking Whapi status.' });
  }
}
