import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

// Phase 12 cleanup: no longer calls lib/auth/user-sessions.ts#revokeSession
// directly — admin-service proxies the revoke to auth-service (the
// user_sessions table's actual owner since Phase 9).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }
  const result = await callAdminService(`/sessions/${id}`, { method: 'DELETE' });
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(result.data);
}
