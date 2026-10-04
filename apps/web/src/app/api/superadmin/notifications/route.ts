import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

// Phase 12 cleanup: no longer calls lib/admin-notifications.ts directly —
// admin_notifications is admin-service's table now.
export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const result = await callAdminService(`/notifications${unreadOnly ? '?unread=1' : ''}`);
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(result.data);
}

export async function POST() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const result = await callAdminService('/notifications', { method: 'POST' });
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(result.data);
}
