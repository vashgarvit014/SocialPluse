import { NextResponse } from 'next/server';
import { createWhatsAppConnectionSession } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';

export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await createWhatsAppConnectionSession());
}
