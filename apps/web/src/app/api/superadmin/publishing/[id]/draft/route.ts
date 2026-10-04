import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const result = await callAdminService(`/publishing/${id}/draft`, { method: 'POST' });
  if (!result.ok) return NextResponse.json({ error: 'Could not move to draft' }, { status: result.status || 503 });
  return NextResponse.json(result.data);
}
