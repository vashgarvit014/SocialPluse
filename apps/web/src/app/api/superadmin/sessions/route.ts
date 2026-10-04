import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 100, 1), 300);
  const result = await callAdminService<{ sessions: unknown[] }>(`/sessions?limit=${limit}`);
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json({ sessions: result.data.sessions });
}
