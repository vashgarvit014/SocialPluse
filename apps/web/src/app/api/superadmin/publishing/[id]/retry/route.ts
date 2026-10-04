import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

// Phase 12 cleanup: no longer calls lib/publishing-monitor.ts directly —
// admin-service proxies to scheduler-service (scheduled_posts' actual
// owner since Phase 6).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const result = await callAdminService(`/publishing/${id}/retry`, { method: 'POST' });
  if (!result.ok) return NextResponse.json({ error: 'Retry failed' }, { status: result.status || 503 });
  return NextResponse.json(result.data);
}
