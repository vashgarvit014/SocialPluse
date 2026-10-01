import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listPublishing } from '@/lib/publishing-monitor';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const statusParam = params.get('status');
  const status = statusParam === 'scheduled' || statusParam === 'published' || statusParam === 'failed' ? statusParam : undefined;
  const platform = params.get('platform') || undefined;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);

  const items = await listPublishing({ status, platform, limit });
  return NextResponse.json({ items });
}
