import { NextResponse } from 'next/server';
import { disconnectWhatsApp } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

// Revokes the CALLING user's WhatsApp connection. The local record is always
// cleared, so a provider-side failure cannot leave the user holding publish
// rights they asked to give up.
export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const outcome = await disconnectWhatsApp(session.userId);
    logSystem({
      level: 'INFO', category: 'PLATFORM', event: 'WHATSAPP_DISCONNECTED',
      userId: session.userId, platform: 'whatsapp',
      message: outcome.providerNotified ? 'WhatsApp disconnected' : 'WhatsApp disconnected locally; provider logout could not be confirmed',
      metadata: { providerNotified: outcome.providerNotified },
    });
    // Always 200: the user IS disconnected from SocialPulse either way, and a
    // 5xx would wrongly imply the disconnect did not happen.
    return NextResponse.json({ success: true, ...outcome });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'WhatsApp could not be disconnected.' }, { status: 502 });
  }
}
