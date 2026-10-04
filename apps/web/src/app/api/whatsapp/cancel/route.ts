import { NextResponse } from 'next/server';
import { cancelPendingQr } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

// Abandons a pending QR. The row moves to CANCELLED, so a late scan or a late
// webhook cannot connect an attempt the user walked away from.
export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    await cancelPendingQr(session.userId);
    logSystem({
      level: 'INFO', category: 'PLATFORM', event: 'WHATSAPP_QR_CANCELLED',
      userId: session.userId, platform: 'whatsapp', message: 'Pending WhatsApp QR cancelled',
    });
    return NextResponse.json({ success: true, status: 'CANCELLED' });
  } catch {
    return NextResponse.json({ success: false, message: 'Could not cancel the pending QR.' }, { status: 500 });
  }
}