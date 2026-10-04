import { proxyToAuthService } from '@/lib/auth-proxy';

export async function POST(request: Request) {
  return proxyToAuthService(request, '/superadmin/settings/email/resend');
}
