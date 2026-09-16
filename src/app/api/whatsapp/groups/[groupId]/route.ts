import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppConfig, waFetch, whatsAppError } from '../../client';

function notConfigured() {
  return NextResponse.json({ success: false, code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to .env.local.' }, { status: 401 });
}

const INFO_FIELDS = 'subject,description,participants,join_approval_mode,suspended,creation_timestamp,total_participant_count';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const config = getWhatsAppConfig();
  if (!config) return notConfigured();
  const { groupId } = await params;

  try {
    const res = await waFetch(`/${groupId}?fields=${INFO_FIELDS}`, config.accessToken);
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'fetching group info');
      return NextResponse.json({ success: false, code, message }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ success: true, group: data });
  } catch (e) {
    console.error('[whatsapp/groups/:id] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error fetching group info.' }, { status: 502 });
  }
}

// Update subject/description. Profile picture upload isn't implemented here
// - it needs multipart media upload, not JSON, and nothing in this app
// currently needs it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const config = getWhatsAppConfig();
  if (!config) return notConfigured();
  const { groupId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Invalid request body.' }, { status: 400 });
  }
  const { subject, description } = body as { subject?: string; description?: string };
  if (!subject && !description) {
    return NextResponse.json({ success: false, code: 'WHATSAPP_NO_CHANGES', message: 'Provide a subject and/or description to update.' }, { status: 400 });
  }

  try {
    const res = await waFetch(`/${groupId}`, config.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        ...(subject ? { subject: subject.slice(0, 128) } : {}),
        ...(description ? { description: description.slice(0, 2048) } : {}),
      }),
    });
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'updating group settings');
      return NextResponse.json({ success: false, code, message }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[whatsapp/groups/:id] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error updating the group.' }, { status: 502 });
  }
}

// Deletes the group and removes all participants, including the business.
// Deliberately no "are you sure" here server-side - the frontend must
// confirm before calling this, same as it must for any other destructive action.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const config = getWhatsAppConfig();
  if (!config) return notConfigured();
  const { groupId } = await params;

  try {
    const res = await waFetch(`/${groupId}`, config.accessToken, { method: 'DELETE' });
    if (!res.ok) {
      const { code, message } = whatsAppError(res.status, await res.text(), 'deleting group');
      return NextResponse.json({ success: false, code, message }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[whatsapp/groups/:id] network failure:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, code: 'WHATSAPP_REQUEST_FAILED', message: 'Network error deleting the group.' }, { status: 502 });
  }
}
