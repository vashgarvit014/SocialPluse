import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listActiveSessions } from '@/lib/auth/user-sessions';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 100, 1), 300);
  const sessions = await listActiveSessions(limit);
  return NextResponse.json({ sessions });
}
