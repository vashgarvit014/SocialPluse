import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { findUserById } from '@/lib/auth/users';

// findUserById()'s User type never carries password_hash/otp/session-token
// fields to begin with (see users.ts#toUser) — there is nothing to
// accidentally leak here even by omission-mistake.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }
  const user = await findUserById(id);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  return NextResponse.json({ user });
}
