import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listAuthEventsFiltered } from '@/lib/auth/audit';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 500);
  const search = params.get('search') || undefined;
  const event = params.get('event') || undefined;
  const channel = params.get('channel') || undefined;

  const events = await listAuthEventsFiltered({ search, event, channel, limit });
  return NextResponse.json({ events });
}
