import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { queryOne } from '@/lib/db';
import { clearModerationFlag, getUserModerationSummary, severityForCount, FLAG_REASON } from '@/lib/moderation-escalation';
import { logSystem } from '@/lib/system-log';

export const dynamic = 'force-dynamic';

// GET  — moderation summary for one account.
// POST — admin action: clear-flag | suspend | reactivate | reset-counter.
//
// Clearing a flag is deliberately always available: a classifier will
// eventually be wrong, and an irreversible moderation state would turn a
// false positive into a permanent, unexplained account problem.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const user = await queryOne<{
    id: string; name: string; email: string; status: string;
    created_at: string; last_login_at: string | null;
  }>(
    `SELECT id, name, email, status, created_at, last_login_at FROM users WHERE id = $1`,
    [id],
  );
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const summary = await getUserModerationSummary(id);
  return NextResponse.json({ user, moderation: { ...summary, severity: severityForCount(summary.violationCount) } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const target = await queryOne<{ id: string }>('SELECT id FROM users WHERE id = $1', [id]);
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  let action = '';
  try {
    ({ action } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  switch (action) {
    case 'clear-flag': {
      const { cleared } = await clearModerationFlag(id);
      return NextResponse.json({ success: true, cleared });
    }
    case 'reset-counter': {
      await queryOne(
        `UPDATE users SET moderation_violation_count = 0, moderation_flagged = false,
                moderation_flag_reason = NULL, moderation_flagged_at = NULL,
                moderation_first_violation_at = NULL, moderation_last_violation_at = NULL,
                updated_at = $2
          WHERE id = $1 RETURNING id`,
        [id, now],
      );
      logSystem({ level: 'INFO', category: 'SYSTEM', event: 'MODERATION_FLAG_CLEARED', userId: session.userId, message: `Moderation counter reset for account ${id}` });
      return NextResponse.json({ success: true });
    }
    case 'suspend': {
      await queryOne(
        `UPDATE users SET status = 'SUSPENDED', session_version = session_version + 1, updated_at = $2
          WHERE id = $1 RETURNING id`,
        [id, now],
      );
      logSystem({
        level: 'WARN', category: 'SYSTEM', event: 'USER_SUSPENDED_FOR_REVIEW',
        userId: session.userId, resourceId: id, message: `Account suspended for moderation review`,
        metadata: { reason: FLAG_REASON, actorAdminId: session.userId },
      });
      return NextResponse.json({ success: true, status: 'SUSPENDED' });
    }
    case 'reactivate': {
      await queryOne(
        `UPDATE users SET status = 'ACTIVE', session_version = session_version + 1, updated_at = $2
          WHERE id = $1 RETURNING id`,
        [id, now],
      );
      logSystem({
        level: 'INFO', category: 'SYSTEM', event: 'USER_REACTIVATED',
        userId: session.userId, resourceId: id, message: `Account reactivated`,
      });
      return NextResponse.json({ success: true, status: 'ACTIVE' });
    }
    default:
      return NextResponse.json({ error: 'Unknown moderation action.' }, { status: 400 });
  }
}
