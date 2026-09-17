import { NextResponse } from 'next/server';
import { getWhatsAppCommunities } from '@/lib/whatsapp-service';

export async function GET() {
  try {
    const communities = await getWhatsAppCommunities();
    return NextResponse.json({ success: true, communities });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'WhatsApp communities could not be loaded.' }, { status: 502 });
  }
}
