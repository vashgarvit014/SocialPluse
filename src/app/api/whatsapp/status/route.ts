import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppStatus } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';

// Connection state for the CALLING user only.
//
// Always user-scoped: this route used to probe the shared deployment channel
// and report its result to whoever asked, so a user with no connection of
// their own was shown as CONNECTED.
//
// `poll=1` additionally runs the exact-session confirmation, which is the only
// thing that can promote a pending QR to CONNECTED.
export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const diagnostics = request.nextUrl.searchParams.get('diagnostics') === '1';
  const poll = request.nextUrl.searchParams.get('poll') === '1';

  try {
    if (poll) {
      const { pollWhatsAppConnection } = await import('@/lib/whatsapp-service');
      const result = await pollWhatsAppConnection(session.userId);
      if (result.confirmedNow) {
        const { logSystem } = await import('@/lib/system-log');
        logSystem({
          level: 'SUCCESS', category: 'PLATFORM', event: 'WHATSAPP_CONNECTED', userId: session.userId, platform: 'whatsapp',
          resourceId: result.providerSessionId, message: 'WhatsApp connected after QR scan',
          metadata: { accountName: result.accountName ?? null },
        });
      }
      return NextResponse.json(result);
    }
    return NextResponse.json(await getWhatsAppStatus(session.userId, diagnostics));
  } catch (error) {
    console.error('[whatsapp/status]', error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        status: 'ERROR', connected: false, currentUserConnected: false, channelAuthenticated: false,
        providerAvailable: false, canStartConnect: false, message: 'WhatsApp connection status could not be read.',
      },
      { status: 502 },
    );
  }
}
