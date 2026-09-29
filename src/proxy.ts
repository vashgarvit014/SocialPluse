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
const SUPERADMIN_AUTH_PAGE = '/superadmin/login';

// Hostname serving the Superadmin interface as a dedicated entry point. On that
// host "/" IS the Superadmin login — the page is rendered there directly, not
// bounced with a redirect, so the address bar shows only the clean domain.
// Compared case-insensitively and on the Host header only — the Host header is
// set by Cloudflare to the hostname the user actually requested, so this is not
// a value a client can forge by sending a different origin. localhost (3000/3001)
// is deliberately NOT in this list, so local development is unaffected.
const SUPERADMIN_HOSTNAMES = new Set([
  'supersocialpulse.dotstark.tech',
]);

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  const isSuperadminHost = SUPERADMIN_HOSTNAMES.has(host);

  // On the Superadmin host, "/" serves the Superadmin login as a REWRITE, so
  // the browser stays on https://supersocialpulse.dotstark.tech and gets a
  // 200 — no redirect hop, no /superadmin/login ever appearing in the URL bar.
  // Next.js keeps this same-host rewrite internal: assets, hydration and
  // client-side navigation are unaffected, and the request below still runs so
  // a signed-in Superadmin reaching "/" lands on the dashboard instead.
  if (isSuperadminHost && (pathname === '/' || pathname === '')) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
    if (await readSessionFromCookieValue(sessionCookie)) {
      const dash = new URL('/superadmin', request.url);
      return NextResponse.redirect(dash);
    }
    return NextResponse.rewrite(new URL(SUPERADMIN_AUTH_PAGE, request.url));
  }

  // Keep the Superadmin host free of the normal SocialPulse site. Only the
  // admin surface, the APIs it calls, and Next's own assets are reachable;
  // every other user-facing page 404s on this domain instead of becoming a
  // second public entrance. Deliberately permissive about /api — the admin
  // dashboard reads logs, publishing, AI usage and auth history, so blocking
  // it would break those screens. The existing role check, not this list, is
  // what actually protects the data.
  if (isSuperadminHost) {
    const isSuperadminPath = pathname === '/superadmin' || pathname.startsWith('/superadmin/');
    const isPlatformPath =
      pathname === '/_next' || pathname.startsWith('/_next/') ||
      pathname === '/api' || pathname.startsWith('/api/');
    const isStaticAsset =
      /\.(?:svg|png|jpe?g|webp|gif|ico|css|js|map|woff2?|ttf|txt|xml|webmanifest|json)$/i.test(pathname);
    if (!isSuperadminPath && !isPlatformPath && !isStaticAsset) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

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

  // The separate Superadmin login page is PUBLIC (unauthenticated users must
  // reach it) and carries its own role enforcement server-side
  // (/api/superadmin/auth/* + the layout gate below). There is no public
  // Superadmin signup — accounts come only from seeding.
  const normPath = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const isSuperadminAuthPage = normPath === '/superadmin/login';

  const session = await readSessionFromCookieValue(request.cookies.get(SESSION_COOKIE)?.value);

  // x-pathname lets the /superadmin layout know which child is rendering so
  // it can skip the SUPERADMIN gate (and the sidebar shell) for exactly the
  // two public auth pages above — never trust client claims for this.
  if (pathname === '/superadmin' || pathname.startsWith('/superadmin/')) {
    const headers = new Headers(request.headers);
    headers.set('x-pathname', normPath);
    if (isSuperadminAuthPage) {
      return NextResponse.next({ request: { headers } });
    }
    if (!session) {
      // Send Superadmin paths to the SUPERADMIN login, not the normal-user
      // one. A normal user can never pass the role check, so bouncing a
      // Superadmin URL to /login-signup lands them on a form that can only
      // ever fail — the callbackUrl is preserved so they return to the page
      // they wanted after signing in.
      const target = new URL(SUPERADMIN_AUTH_PAGE, request.url);
      target.searchParams.set('callbackUrl', pathname + search);
      return NextResponse.redirect(target);
    }
    return NextResponse.next({ request: { headers } });
  }

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
