import { NextResponse } from 'next/server';
import { requireApiSuperadmin } from '@/lib/auth/roles';

// Post-OTP role confirmation for the separate Superadmin UI: 200 only when
// the current session belongs to a SUPERADMIN (fresh DB read, never a
// client claim). The /superadmin layout gate remains the real enforcer;
// this just lets /superadmin/login|signup decide where to redirect.
export async function GET() {
  const session = await requireApiSuperadmin();
  if (session instanceof NextResponse) return session;
  const { user } = session;
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
