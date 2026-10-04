import { NextRequest, NextResponse } from 'next/server';
import { RETURN_COOKIE } from '@/lib/oauth-return';
import { requireApiSession } from '@/lib/auth/api';

export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  // Starting a connection requires being signed in. The per-platform /auth
  // routes record the signed-in user against the OAuth state, but this entry
  // point used to have no check at all, so an unauthenticated visitor could
  // seed the editor-return cookie for any platform.
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { platform } = await context.params;
  const id = request.nextUrl.searchParams.get('return_id') || '';
  if (!/^[a-f0-9-]{36}$/.test(id) || !['linkedin', 'facebook', 'instagram', 'canva', 'whatsapp'].includes(platform)) return NextResponse.json({ error: 'Invalid connection request' }, { status: 400 });
  if (platform === 'whatsapp') {
    const target = new URL('/oauth-return', request.url);
    target.searchParams.set('editor_return', id); target.searchParams.set('provider', platform);
    target.searchParams.set('error', 'WhatsApp uses server configuration; OAuth is not implemented.');
    return NextResponse.redirect(target);
  }
  const target = new URL(`/api/${platform}/auth`, process.env.NEXT_PUBLIC_APP_URL || request.url);
  const response = NextResponse.redirect(target);
  response.cookies.set(RETURN_COOKIE, JSON.stringify({ id, platform }), { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 1800 });
  return response;
}
