import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { revokeSession } from '@/lib/auth/user-sessions';
import { logAuthEvent } from '@/lib/auth/audit';

// Marks the tracked row revoked — the next request bearing that session's
// JWT fails dal.ts#verifySession's touchAndCheckSession() check and is
// treated as logged out. The JWT cookie itself isn't (can't be) deleted
// remotely; this is what "Terminate session" actually does.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }
  await revokeSession(id);
  logAuthEvent('SESSION_TERMINATED', { meta: { terminatedBy: session.userId, sessionId: id } });
  return NextResponse.json({ success: true });
}
