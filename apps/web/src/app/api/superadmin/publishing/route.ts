import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

// Phase 12 cleanup: no longer calls lib/publishing-monitor.ts directly.
export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const statusParam = params.get('status');
  const status = statusParam === 'scheduled' || statusParam === 'published' || statusParam === 'failed' ? statusParam : undefined;
  const platform = params.get('platform') || undefined;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);

  const qs = new URLSearchParams({ limit: String(limit) });
  if (status) qs.set('status', status);
  if (platform) qs.set('platform', platform);
  const result = await callAdminService<{ items: unknown[] }>(`/publishing?${qs.toString()}`);
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json({ items: result.data.items });
}
