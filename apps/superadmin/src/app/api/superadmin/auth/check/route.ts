import { proxyToAuthService } from '@/lib/auth-proxy';

export async function GET(request: Request) {
  return proxyToAuthService(request, '/superadmin/check');
}
