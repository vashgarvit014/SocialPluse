import { NextResponse } from 'next/server';
import { createWhatsAppConnectionSession } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

// Starts a QR pairing attempt for the CALLING user.
//
// This returns WAITING_FOR_SCAN, never CONNECTED. The previous implementation
// returned CONNECTED whenever /users/login/rowdata answered 409 ("channel
// already authenticated"), which is what made the UI jump to Connected with no
// scan — and because the channel came from a shared env token, that same 409
// applied to every user of the deployment.
export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const result = await createWhatsAppConnectionSession(session.userId);
    if (result.status === 'WAITING_FOR_SCAN') {
      logSystem({
        level: 'INFO', category: 'PLATFORM', event: 'WHATSAPP_QR_ISSUED', userId: session.userId, platform: 'whatsapp',
        resourceId: result.providerSessionId, message: 'WhatsApp QR code issued; waiting for scan',
        metadata: { qrExpiresAt: result.qrExpiresAt ?? null },
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[whatsapp/connect]', error instanceof Error ? error.message : error);
    return NextResponse.json({ status: 'ERROR', message: 'WhatsApp connection could not be started.' }, { status: 502 });
  }
}
