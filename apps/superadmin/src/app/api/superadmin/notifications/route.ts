import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadminSession } from '@/lib/session';
import { callAdminService } from '@/lib/admin-client';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const result = await callAdminService(`/notifications${unreadOnly ? '?unread=1' : ''}`);
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(result.data);
}

export async function POST() {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const result = await callAdminService('/notifications', { method: 'POST' });
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(result.data);
}
