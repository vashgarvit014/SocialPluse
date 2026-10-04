import 'server-only';
import { proxyToGateway } from './gateway-client';

// apps/superadmin's equivalent of the gateway's proxyToService, scoped to
// auth-service only. Forwards the Cookie header (pending-auth/session) and
// relays every Set-Cookie back untouched — same two bugs already fixed
// once in the gateway (redirect:'manual', headers.getSetCookie() instead
// of .forEach()) are avoided here from the start.
export async function proxyToAuthService(request: Request, path: string): Promise<Response> {
  const gatewayPath = path.startsWith('/superadmin/') ? `/api${path}` : `/api/auth${path}`;
  return proxyToGateway(request, gatewayPath);
}
