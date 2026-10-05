import { sameOriginRedirect } from '@/lib/same-origin-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Destination deliberately unchanged from the original shim (the Facebook
  // auth start). Only the URL construction is fixed — see
  // src/lib/same-origin-redirect.ts for why request.url must not be used.
  return sameOriginRedirect('/api/facebook/auth');
}
