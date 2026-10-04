import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppConfig, waFetch, whatsAppError } from '../../../client';
import { requireApiSession } from '@/lib/auth/api';

// Removal only - there is no "add participant" endpoint. Joining only
// happens via the invite link (see ../invite-link/route.ts), which is a
// deliberate WhatsApp platform restriction, not a gap in this route.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
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
  const { participants } = body as { participants?: string[] };
  if (!Array.isArray(participants) || participants.length === 0) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_PARTICIPANTS_REQUIRED', message: 'A non-empty participants array (phone numbers or WhatsApp user IDs) is required.' }, { status: 400 });
  }
  if (participants.length > 8) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_TOO_MANY_PARTICIPANTS', message: 'Meta caps participant removal at 8 per request - split into multiple calls.' }, { status: 400 });
  }

  try {
    const res = await waFetch(`/${groupId}/participants`, config.accessToken, {
      method: 'DELETE',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        participants: participants.map(user => ({ user })),
      }),
    });
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'removing group participants');
      return NextResponse.json({ success: false, code, message }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[whatsapp/groups/:id/participants] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error removing participants.' }, { status: 502 });
  }
}
