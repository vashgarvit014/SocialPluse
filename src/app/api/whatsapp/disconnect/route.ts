import { NextResponse } from 'next/server';
import { disconnectWhatsApp } from '@/lib/whatsapp-service';

export async function POST() {
  try {
    await disconnectWhatsApp();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'WhatsApp could not be disconnected.' }, { status: 502 });
  }
}
