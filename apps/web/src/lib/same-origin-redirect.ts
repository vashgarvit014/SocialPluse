import { NextResponse } from 'next/server';

/**
 * Same-origin redirect that does NOT depend on what the app thinks its own
 * host is.
 *
 * Why this exists: `new URL('/somewhere', request.url)` produces
 * `https://0.0.0.0:3000/somewhere` in this deployment. Next's standalone
 * server reports `request.url` with host `0.0.0.0` (see the same note in
 * src/lib/canva.ts), so every such redirect pointed the browser at
 * `https://0.0.0.0:3000/...` — which fails with ERR_SSL_PROTOCOL_ERROR
 * because the container only speaks plain HTTP. That broke Instagram (which
 * redirects to the Facebook auth start) and, more damagingly,
 * /api/connect/[platform], the entry point EVERY platform connection goes
 * through.
 *
 * A relative Location is valid per RFC 7231 §7.1.2 and the browser resolves it
 * against the origin it is already on. That is correct for every host we are
 * ever reached on — production tunnel, 127.0.0.1, localhost, or 0.0.0.0 — so
 * no Host header or reconstructed URL has to be trusted.
 *
 * `NextResponse.redirect()` insists on an absolute URL, hence the manual
 * response here. Cookies can still be attached to the returned object.
 */
export function sameOriginRedirect(path: string, status = 307): NextResponse {
  const headers = new Headers();
  headers.set('location', path.startsWith('/') ? path : `/${path}`);
  return new NextResponse(null, { status, headers });
}