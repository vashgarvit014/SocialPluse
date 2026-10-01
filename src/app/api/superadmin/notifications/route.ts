import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listNotifications, markAllRead, unreadCount } from '@/lib/admin-notifications';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const [notifications, unread] = await Promise.all([listNotifications({ unreadOnly, limit: 50 }), unreadCount()]);
  return NextResponse.json({ notifications, unreadCount: unread });
}

export async function POST() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ success: true, updated: await markAllRead() });
}
