import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { markRead } from '@/lib/admin-notifications';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  return NextResponse.json({ success: await markRead(id) });
}