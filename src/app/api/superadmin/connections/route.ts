import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { getConnectionsOverview } from '@/lib/auth/connections';

export async function GET() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  return NextResponse.json({ connections: getConnectionsOverview() });
}
