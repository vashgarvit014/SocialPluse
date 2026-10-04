import { NextResponse } from 'next/server';
import { requireApiSuperadminSession } from '@/lib/session';
import { callAdminService } from '@/lib/admin-client';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const result = await callAdminService(`/notifications/${id}`, { method: 'PATCH' });
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(result.data);
}
