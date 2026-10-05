import { NextRequest, NextResponse } from 'next/server';
import { RETURN_COOKIE } from '@/lib/oauth-return';
import { sameOriginRedirect } from '@/lib/same-origin-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const id = request.nextUrl.searchParams.get('return_id') || '';
  if (!/^[a-f0-9-]{36}$/.test(id) || !['linkedin', 'facebook', 'instagram', 'canva', 'whatsapp'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid connection request' }, { status: 400 });
  }
  if (platform === 'whatsapp') {
    // Relative Location, not new URL('/oauth-return', request.url) — see
    // src/lib/same-origin-redirect.ts. Building it from request.url produced
    // https://0.0.0.0:3000/... and ERR_SSL_PROTOCOL_ERROR in the browser.
    const target = new URLSearchParams({
      editor_return: id,
      provider: platform,
      error: 'WhatsApp uses server configuration; OAuth is not implemented.',
    });
    return sameOriginRedirect(`/oauth-return?${target.toString()}`);
  }
  // Same fix as above: this is the entry point EVERY platform connection goes
  // through, so building it from request.url broke LinkedIn, Facebook,
  // Instagram and Canva at once.
  const response = sameOriginRedirect(`/api/${platform}/auth`);
  response.cookies.set(RETURN_COOKIE, JSON.stringify({ id, platform }), {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 1800,
  });
  return response;
}
