import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, readSessionFromCookieValue } from '@/lib/auth/session';

// Optimistic, cookie-only auth gate for pages (App Router file convention —
// "middleware.ts" was renamed to "proxy.ts" in Next.js 16, same behavior:
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// This never touches the DB — it only decides whether to let a page render
// or bounce to /login-signup. Route Handlers still verify the session
// themselves via src/lib/auth/dal.ts before returning data; this is not a
// substitute for that (see the Next.js auth guide's "Optimistic checks" note).
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/content-studio',
  '/scheduler',
  '/analytics',
  '/connect-platforms',
  '/asset-gallery',
  // Cookie-only check here just proves "is anyone logged in" — the actual
  // role !== SUPERADMIN → 403/redirect decision needs a DB read for the
  // user's current role (never trust a role baked into the cookie), so it
  // happens in requireSuperadmin() (src/lib/auth/roles.ts) at the layout
  // level, same "optimistic here, real check deeper" split this file's
  // header comment already documents for every other protected route.
  '/superadmin',
];

const AUTH_PAGE = '/login-signup';

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Canva's Return URL is registered (externally, in Canva's developer
  // portal) as /content-studio — it lands here as a same-tab or popup GET
  // carrying correlation_jwt, which /content-studio/page.tsx verifies and
  // relays to /api/canva/return. That verification IS the security check
  // for this leg of the flow, so let it through even if our own session
  // cookie happens to be stale — don't block a provider callback by accident.
  if (pathname === '/content-studio' && request.nextUrl.searchParams.has('correlation_jwt')) {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isAuthPage = pathname === AUTH_PAGE;

  if (!isProtected && !isAuthPage) return NextResponse.next();

  const session = await readSessionFromCookieValue(request.cookies.get(SESSION_COOKIE)?.value);

  if (isProtected && !session) {
    const target = new URL(AUTH_PAGE, request.url);
    target.searchParams.set('callbackUrl', pathname + search);
    return NextResponse.redirect(target);
  }

  if (isAuthPage && session) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};
