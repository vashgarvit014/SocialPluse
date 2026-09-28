import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/dal';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  // DTO: only the fields the header/profile menu needs — never passwordHash.
  return NextResponse.json({ user: { name: user.name, email: user.email } });
}
