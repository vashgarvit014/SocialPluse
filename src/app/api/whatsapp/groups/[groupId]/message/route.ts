import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppConfig, waFetch, whatsAppError } from '../../../client';

// The actual "broadcast" step: one call here reaches every participant
// already in the group. Getting people INTO the group first is a separate
// step (share the invite link - see invite-link/route.ts and
// ../../send-message/route.ts) - group membership is invite-link-based,
// there is no "add participant by phone number" push API.
export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const config = getWhatsAppConfig();
  if (!config) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to .env.local.' }, { status: 401 });
  }
  const { groupId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' }, { status: 400 });
  }
  const { message } = body as { message?: string };
  if (!message || !message.trim()) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_MESSAGE_REQUIRED', message: 'A message body is required.' }, { status: 400 });
  }

  try {
    const res = await waFetch(`/${config.phoneNumberId}/messages`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'group',
        to: groupId,
        type: 'text',
        text: { preview_url: true, body: message },
      }),
    });
    if (!res.ok) {
      const { code, message: errMessage } = whatsAppError(res.status, await res.text(), 'sending group message');
      return NextResponse.json({ success: false, code, message: errMessage }, { status: res.status === 429 ? 429 : 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, messageId: data.messages?.[0]?.id });
  } catch (e) {
    console.error('[whatsapp/groups/:id/message] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error sending the group message.' }, { status: 502 });
  }
}
