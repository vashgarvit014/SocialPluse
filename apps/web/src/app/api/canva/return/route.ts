import { proxyToGateway } from '@/lib/gateway-proxy';
import { sameOriginRedirect } from '@/lib/same-origin-redirect';

export const dynamic = 'force-dynamic';

// Canva's Return-navigation leg (the "Return to SocialPulse" button in the
// editor) reaches us as a THIRD-PARTY top-level GET, exactly like /callback.
// The gateway deliberately session-gates it (skipAuth: false) because the
// pending-design handoff is looked up by the authenticated user — but the
// session can expire while the user is off editing in Canva, and this route is
// reachable from /content-studio and from the root page relay.
//
// The proxy lets /content-studio?correlation_jwt=... through even with a stale
// cookie, so the request reaches us and then gets a bare 401 JSON body from
// the gateway — the user stares at {"code":"UNAUTHORIZED"} instead of the
// /canva-return hand-off card this whole flow is built around. Turn that one
// case into the designed failure navigation; every other status (including the
// service's own 302s and 4xx/5xx) is relayed untouched.
//
// Redirect target is built relative on purpose: request.url can carry a
// 0.0.0.0 dev host that the browser cannot follow. See same-origin-redirect.ts.
export async function GET(request: Request) {
  const res = await proxyToGateway(request);
  if (res.status === 401) {
    return sameOriginRedirect('/canva-return?error=CANVA_SESSION_EXPIRED');
  }
  return res;
}

export async function POST(request: Request) { return proxyToGateway(request); }
export async function PATCH(request: Request) { return proxyToGateway(request); }
export async function DELETE(request: Request) { return proxyToGateway(request); }