import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppStatus } from '@/lib/whatsapp-service';
import { requireApiSession } from '@/lib/auth/api';

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const diagnostics = request.nextUrl.searchParams.get('diagnostics') === '1';
  return NextResponse.json(await getWhatsAppStatus(diagnostics));
}
