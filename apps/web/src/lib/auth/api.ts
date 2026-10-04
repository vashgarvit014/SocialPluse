import 'server-only';
import { NextResponse } from 'next/server';
import { verifySession } from './dal';
import type { User } from './users';

// For Route Handlers only (never redirects — API callers need a 401, not an
// HTML redirect to /login-signup). Usage:
//   const session = await requireApiSession();
//   if (session instanceof NextResponse) return session;
export async function requireApiSession(): Promise<{ userId: string; user: User } | NextResponse> {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return session;
}
