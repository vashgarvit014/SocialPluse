import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { setUserStatus } from '@/lib/auth/users';
import { logAuthEvent, clientIp } from '@/lib/auth/audit';

const bodySchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) });

// Suspend/Activate/Reactivate — deliberately the only status transitions
// exposed (see users.ts#setUserStatus for why PENDING is excluded, and the
// spec's explicit "prefer suspend over hard delete"). Suspending needs no
// separate session-invalidation step: dal.ts#verifySession already rejects
// any session whose user.status !== 'ACTIVE', so the next request from that
// user (page or API) fails closed on its own.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });

  const result = await setUserStatus(id, parsed.data.status);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  logAuthEvent(parsed.data.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED', {
    userId: id, ip: clientIp(request), meta: { actorUserId: session.userId },
  });

  return NextResponse.json({ success: true, status: parsed.data.status });
}
