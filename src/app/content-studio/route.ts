import { NextRequest, NextResponse } from 'next/server';
import { APP_ORIGIN } from '@/lib/canva';

// This path is registered as the Canva integration's "Return URL" (Return
// navigation, in the developer portal) - Canva sends the browser here with
// ?correlation_jwt=... once the user finishes editing. All the actual work
// (verify the JWT, mark the design ready to import) lives in
// /api/canva/return; we just relay the request there unchanged.
export async function GET(request: NextRequest) {
  const target = new URL('/api/canva/return', APP_ORIGIN);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target);
}
