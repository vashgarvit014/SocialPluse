import 'server-only';
import { proxyToGateway } from './gateway-client';

// apps/superadmin's equivalent of the gateway's proxyToService, scoped to
// auth-service only. Forwards the Cookie header (pending-auth/session) and
// relays every Set-Cookie back untouched — same two bugs already fixed
// once in the gateway (redirect:'manual', headers.getSetCookie() instead
// of .forEach()) are avoided here from the start.
// The gateway's route table nests login/check under an extra /auth/
// segment for these two specific superadmin endpoints (unlike the other
// /superadmin/settings/* paths, which map 1:1) — so those two need their
// own case rather than the generic /superadmin/ -> /api/superadmin/ rule.
const SUPERADMIN_AUTH_PATHS = new Set(['/superadmin/login', '/superadmin/check']);

export async function proxyToAuthService(request: Request, path: string): Promise<Response> {
  const gatewayPath = SUPERADMIN_AUTH_PATHS.has(path)
    ? `/api/superadmin/auth${path.slice('/superadmin'.length)}`
    : path.startsWith('/superadmin/') ? `/api${path}` : `/api/auth${path}`;
  return proxyToGateway(request, gatewayPath);
}
