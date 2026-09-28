import { NextResponse } from 'next/server';
import { clearTokenCookies } from '@/lib/canva';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

// A real disconnect: deletes the stored access/refresh tokens outright
// (there's nothing left to revoke server-side beyond these cookies - Canva
// has no separate token-revocation endpoint in the Connect API), rather than
// just flipping a "connected" flag while tokens remain usable.
export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const res = NextResponse.json({ connected: false, success: true });
  clearTokenCookies(res);
  logSystem({ level: 'INFO', category: 'PLATFORM', event: 'CANVA_DISCONNECTED', userId: session.userId, platform: 'canva', message: 'Canva disconnected' });
  return res;
}
