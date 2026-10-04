import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { getAiUsageStats } from '@/lib/ai-usage';

export async function GET() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const stats = await getAiUsageStats();
  return NextResponse.json(stats);
}
