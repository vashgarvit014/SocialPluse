import { NextResponse } from 'next/server';
import { createWhatsAppConnectionSession } from '@/lib/whatsapp-service';

export async function POST() {
  return NextResponse.json(await createWhatsAppConnectionSession());
}
