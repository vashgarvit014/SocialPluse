import { NextResponse } from 'next/server';
import { disconnectWhatsApp } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';
import { logSystem } from '@/lib/system-log';

export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    await disconnectWhatsApp();
    logSystem({ level: 'INFO', category: 'PLATFORM', event: 'WHATSAPP_DISCONNECTED', userId: session.userId, platform: 'whatsapp', message: 'WhatsApp disconnected' });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'WhatsApp could not be disconnected.' }, { status: 502 });
  }
}
