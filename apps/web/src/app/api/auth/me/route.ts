import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/dal';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  // DTO: only the fields the header/profile menu needs — never passwordHash.
  //
  // `id` is the caller's OWN id, taken from their verified session cookie. It
  // is not sensitive (it is not another user's id, and it is not a credential)
  // but the client genuinely needs it: browser state is namespaced per account
  // (see lib/client-identity.ts) so one user on a shared browser can never see
  // the previous user's draft or connected accounts.
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
}
