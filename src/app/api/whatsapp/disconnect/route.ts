import { NextResponse } from 'next/server';
import { disconnectWhatsApp } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';

export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    await disconnectWhatsApp();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'WhatsApp could not be disconnected.' }, { status: 502 });
  }
}
