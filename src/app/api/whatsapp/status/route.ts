import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppStatus } from '@/lib/whatsapp-service';

export async function GET(request: NextRequest) {
  const diagnostics = request.nextUrl.searchParams.get('diagnostics') === '1';
  return NextResponse.json(await getWhatsAppStatus(diagnostics));
}
