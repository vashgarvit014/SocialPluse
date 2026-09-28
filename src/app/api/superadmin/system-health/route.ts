import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { getSystemHealth } from '@/lib/auth/system-health';

export async function GET() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const checks = await getSystemHealth();
  return NextResponse.json({ checks });
}
