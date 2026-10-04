import { NextResponse } from 'next/server';
import { requireApiSuperadminSession } from '@/lib/session';
import { callAdminService } from '@/lib/admin-client';

// Proxies to admin-service -> user-service's PATCH /internal/users/:id/status.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.status !== 'ACTIVE' && body.status !== 'SUSPENDED') {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  const result = await callAdminService(`/users/${id}/status`, { method: 'PATCH', body });
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: result.status || 503 });
  return NextResponse.json(result.data);
}
