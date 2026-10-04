import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { verifyInternalActor, INTERNAL_HEADER } from '@/lib/internal-auth';

// Phase 11 cleanup: this route used to claim and publish due posts itself
// (claimDuePosts + publishPost, see MIGRATION-NOTES.md Phase 10 §4 finding
// 4 and Phase 11 for the full writeup). That logic had a real, documented
// TOCTOU race (src/lib/db.ts's own comment named it) AND was independently,
// concurrently triggered by (a) every open browser tab's 60-second poll in
// social-media-manager.tsx, (b) the Superadmin "Check Due Posts Now"
// button, AND (c) scheduler-service's own always-running worker loop
// (Phase 6) — three callers racing to claim the same `scheduled_posts`
// rows with no atomic guard between two of them. scheduler-service's own
// claim (`claimDueJob`, with proper locking) was always correct; THIS
// route was the unsafe one.
//
// Now a pure proxy: every claim and every publish happens in exactly one
// place, scheduler-service. This route no longer touches `scheduled_posts`
// or calls any provider API itself — it only relays to scheduler-service's
// own internal-secret-gated `/scheduler/check`, preserving the exact
// response shape (`{publishedCount, checkedAt}`) and the exact caller
// contract (Superadmin, or a signed internal actor) the frontend already
// depends on.
//
// scheduler-service's `/scheduler/check` claims and publishes at most ONE
// due post per call (by design — the same call shape its own background
// loop uses). The original route drained the whole due queue in one
// request, so this loops calls to preserve that same "drain everything
// due right now" behavior for a manual "Check Now" click — capped at 200,
// matching the original's own `LIMIT 200` on due posts per check.
const SCHEDULER_SERVICE_URL = process.env.SCHEDULER_SERVICE_URL || 'http://scheduler-service:4007';
const MAX_DRAIN_PER_CHECK = 200;

export async function POST(request: Request) {
  const internal = verifyInternalActor(request.headers.get(INTERNAL_HEADER));
  if (!internal) {
    const admin = await requireApiSuperadmin();
    if (admin instanceof NextResponse) return admin;
  }

  const secret = process.env.INTERNAL_SERVICE_SECRET || '';
  let publishedCount = 0;
  for (let i = 0; i < MAX_DRAIN_PER_CHECK; i++) {
    let res: Response;
    try {
      res = await fetch(`${SCHEDULER_SERVICE_URL}/scheduler/check`, {
        method: 'POST',
        headers: { 'x-internal-secret': secret },
      });
    } catch {
      // scheduler-service unreachable — report what was actually published
      // before the failure rather than a hard error, same as the original
      // route never distinguished "nothing due" from a mid-run failure.
      break;
    }
    if (!res.ok) break;
    const data = await res.json().catch(() => ({ publishedCount: 0 }));
    const count = typeof data.publishedCount === 'number' ? data.publishedCount : 0;
    publishedCount += count;
    if (count === 0) break; // queue drained
  }

  return NextResponse.json({ publishedCount, checkedAt: new Date().toISOString() });
}
