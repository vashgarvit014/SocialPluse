import { NextRequest, NextResponse } from 'next/server';

// apps/superadmin serves exactly one surface — there is no public-site
// hostname to branch on (that logic, src/lib/admin-host.ts +
// src/proxy.ts's host checks, stays in apps/web, unchanged). The only
// job here is forwarding the requested pathname so the root layout can
// tell "/superadmin/login" (render bare, no auth gate) apart from every
// other page (render the full shell, behind requireSuperadminSession()).
export default function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
