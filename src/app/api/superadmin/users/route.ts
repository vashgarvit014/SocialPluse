import { NextRequest, NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listUsers } from '@/lib/auth/users';

export async function GET(request: NextRequest) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const params = request.nextUrl.searchParams;
  const search = params.get('search') || undefined;
  const statusParam = params.get('status');
  const status = statusParam === 'ACTIVE' || statusParam === 'PENDING' || statusParam === 'SUSPENDED' ? statusParam : undefined;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);

  const { users, total } = await listUsers({ search, status, limit, offset });
  return NextResponse.json({ users, total, limit, offset });
}

// User creation from Superadmin is intentionally disabled: Superadmin
// accounts come only from the seed script, and normal USER accounts only
// from public signup. Kept as an explicit 410 (not deleted) so any old
// client gets a clear answer instead of a confusing 404/405.
export async function POST() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(
    { error: 'User creation from Superadmin is disabled. New USER accounts come only from public signup; the Superadmin account comes only from seeding.' },
    { status: 410 },
  );
}
