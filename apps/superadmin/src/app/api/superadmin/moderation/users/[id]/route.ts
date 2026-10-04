import { NextResponse } from 'next/server';
import { requireApiSuperadminSession } from '@/lib/session';
import { callAdminService } from '@/lib/admin-client';

// Proxies to admin-service -> user-service. apps/superadmin never touches
// Postgres directly — same contract as apps/web's Phase 11/12 SSR pages
// (src/app/superadmin/moderation/page.tsx, users/[id]/page.tsx).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const result = await callAdminService(`/moderation/users/${id}`);
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(result.data);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const result = await callAdminService(`/moderation/users/${id}`, { method: 'POST', body });
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: result.status || 503 });
  return NextResponse.json(result.data);
}
