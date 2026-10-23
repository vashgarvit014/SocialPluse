import { NextResponse } from 'next/server';
import { requireApiSuperadminSession } from '@/lib/session';
import { callAdminService } from '@/lib/admin-client';

// Proxies to admin-service -> user-service, same contract as the existing
// moderation/users/[id] route. GET returns the incident detail (plus a
// short-lived mediaViewUrl when applicable); POST applies an action
// (mark-under-review | resolve | dismiss-false-positive | escalate-restricted).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const result = await callAdminService(`/moderation/violations/${id}`);
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: result.status || 503 });
  return NextResponse.json(result.data);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const result = await callAdminService(`/moderation/violations/${id}`, { method: 'POST', body });
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: result.status || 503 });
  return NextResponse.json(result.data);
}
