import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';

// Phase 12 cleanup: no longer calls lib/auth/system-health.ts directly.
export async function GET() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const result = await callAdminService<{ checks: unknown[] }>('/system-health');
  if (!result.ok) return NextResponse.json({ error: 'Admin service is temporarily unavailable.' }, { status: 503 });
  return NextResponse.json({ checks: result.data.checks });
}
