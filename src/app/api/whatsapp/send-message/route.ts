import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppConfig, waFetch, whatsAppError } from '../client';

// Sends a 1:1 message - this is how you actually invite someone to a group
// (send them the invite link from ../groups/[groupId]/invite-link), since
// there's no push-add-participant API.
//
// IMPORTANT PLATFORM RULE, not a bug: WhatsApp only allows a business to
// freely send plain text/media messages to a user within a 24-hour window
// after that user last messaged the business ("customer service window").
// Outside that window, only pre-approved MESSAGE TEMPLATES can be sent -
// this route only sends plain text. A cold outreach to someone who has
// never messaged this business number will be rejected by Meta with a
// real 4xx error (not something retrying fixes) until either: they message
// the number first, or this route is extended to send an approved template
// instead (a separate Meta-side setup: WhatsApp Manager > Message Templates).
export async function POST(request: NextRequest) {
  const config = getWhatsAppConfig();
  if (!config) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to .env.local.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' }, { status: 400 });
  }
  const { to, message } = body as { to?: string; message?: string };
  if (!to || !message?.trim()) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_FIELDS_REQUIRED', message: 'Both "to" (phone number, E.164 format e.g. +15551234567) and "message" are required.' }, { status: 400 });
  }

  try {
    const res = await waFetch(`/${config.phoneNumberId}/messages`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: true, body: message },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      const { code, message: errMessage } = whatsAppError(res.status, errBody, 'sending message');
      // Outside the 24h customer-service window Meta returns a specific
      // recognizable error (code 131047 / "re-engagement" in the body) -
      // surface that distinctly since "try again" won't help, a template
      // message would.
      const outsideWindow = /re-?engagement|24.?hour|131047/i.test(errBody);
      return NextResponse.json({
        success: false,
        code: outsideWindow ? 'WHATSAPP_OUTSIDE_SERVICE_WINDOW' : code,
        message: outsideWindow
          ? 'This number has not messaged your business recently, so a plain text message cannot be sent (WhatsApp\'s 24-hour customer service window rule). Use an approved message template instead, or have them message you first.'
          : errMessage,
      }, { status: res.status === 429 ? 429 : 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, messageId: data.messages?.[0]?.id });
  } catch (e) {
    console.error('[whatsapp/send-message] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error sending the message.' }, { status: 502 });
  }
}
