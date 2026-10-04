import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

// Phase 12 cleanup: no longer calls lib/auth/audit.ts directly.
export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const search = params.get('search') || undefined;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 300);

  const qs = new URLSearchParams({ limit: String(limit) });
  if (search) qs.set('search', search);
  const result = await callAdminService<{ events: unknown[] }>(`/audit-logs?${qs.toString()}`);
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json({ events: result.data.events });
}
