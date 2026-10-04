import { notFound } from 'next/navigation';

// Rewrite target for paths that must return a 404 STATUS with the site's
// styled 404 screen.
//
// src/proxy.ts cannot produce this itself:
//   - returning `new NextResponse('Not found', { status: 404 })` gives a real
//     status but a bare text/plain body;
//   - NextResponse.rewrite() gives the styled page but always a 200.
//
// Calling notFound() from a page gets both: Next renders the nearest
// not-found boundary (src/app/not-found.tsx) with a genuine 404 status.
//
// This route is only reachable via that rewrite. On the admin subdomain the
// proxy's own filter already 404s it, and on the public host it is an
// ordinary harmless page — there is nothing to protect here, because admin
// screens are gated through the gateway/auth-service boundary.
export default function NotFoundStatusRoute() {
  notFound();
}
