import { NextResponse } from 'next/server';
import { getWhatsAppCommunities } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const communities = await getWhatsAppCommunities();
    return NextResponse.json({ success: true, communities });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'WhatsApp communities could not be loaded.' }, { status: 502 });
  }
}
