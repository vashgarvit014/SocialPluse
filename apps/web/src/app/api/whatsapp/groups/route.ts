import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppConfig, waFetch, whatsAppError } from '../client';
import { requireApiSession } from '@/lib/auth/api';

function notConfigured() {
  return NextResponse.json({ success: false, code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to .env.local.' }, { status: 401 });
}

// Create a group. Groups requires Official Business Account (OBA) status on
// the phone number - a real "insufficient permission" Graph API error here
// most likely means that isn't granted, not a bug in this route.
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const config = getWhatsAppConfig();
  if (!config) return notConfigured();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' }, { status: 400 });
  }
  const { subject, description, joinApprovalMode } = body as { subject?: string; description?: string; joinApprovalMode?: 'approval_required' | 'auto_approve' };
  if (!subject || !subject.trim()) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_SUBJECT_REQUIRED', message: 'A group subject (name) is required.' }, { status: 400 });
  }

  try {
    const res = await waFetch(`/${config.phoneNumberId}/groups`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        subject: subject.trim().slice(0, 128),
        ...(description ? { description: description.slice(0, 2048) } : {}),
        ...(joinApprovalMode ? { join_approval_mode: joinApprovalMode } : {}),
      }),
    });
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'group creation');
      return NextResponse.json({ success: false, code, message }, { status: res.status === 429 ? 429 : 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, groupId: data.id });
  } catch (e) {
    console.error('[whatsapp/groups] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error creating the group.' }, { status: 502 });
  }
}

// Lists groups the business phone number currently belongs to.
export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const config = getWhatsAppConfig();
  if (!config) return notConfigured();

  const limit = request.nextUrl.searchParams.get('limit') || '25';
  const after = request.nextUrl.searchParams.get('after');
  const params = new URLSearchParams({ limit });
  if (after) params.set('after', after);

  try {
    const res = await waFetch(`/${config.phoneNumberId}/groups?${params.toString()}`, config.accessToken);
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'listing groups');
      return NextResponse.json({ success: false, code, message }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, groups: data.data || [], paging: data.paging || null });
  } catch (e) {
    console.error('[whatsapp/groups] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error listing groups.' }, { status: 502 });
  }
}
