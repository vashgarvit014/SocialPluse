import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listAdminAuditEvents } from '@/lib/auth/audit';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const search = params.get('search') || undefined;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 300);

  const events = await listAdminAuditEvents({ search, limit });
  return NextResponse.json({ events });
}
