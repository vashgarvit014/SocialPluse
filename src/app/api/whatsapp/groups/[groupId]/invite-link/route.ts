import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppConfig, waFetch, whatsAppError } from '../../../client';
import { requireApiSession } from '@/lib/auth/api';

function notConfigured() {
  return NextResponse.json({ success: false, code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to .env.local.' }, { status: 401 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const config = getWhatsAppConfig();
  if (!config) return notConfigured();
  const { groupId } = await params;

  try {
    const res = await waFetch(`/${groupId}/invite_link`, config.accessToken);
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'fetching invite link');
      return NextResponse.json({ success: false, code, message }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, inviteLink: data.invite_link });
  } catch (e) {
    console.error('[whatsapp/invite-link] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error fetching the invite link.' }, { status: 502 });
  }
}

// Resets the invite link - the previous one stops working immediately. Use
// deliberately, not on every load.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const config = getWhatsAppConfig();
  if (!config) return notConfigured();
  const { groupId } = await params;

  try {
    const res = await waFetch(`/${groupId}/invite_link`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp' }),
    });
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'resetting invite link');
      return NextResponse.json({ success: false, code, message }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, inviteLink: data.invite_link });
  } catch (e) {
    console.error('[whatsapp/invite-link] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error resetting the invite link.' }, { status: 502 });
  }
}
