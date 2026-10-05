import { sameOriginRedirect } from '@/lib/same-origin-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Relative Location, not new URL(..., request.url): see
  // src/lib/same-origin-redirect.ts — request.url reports host 0.0.0.0 in this
  // deployment, which produced https://0.0.0.0:3000/... and ERR_SSL_PROTOCOL_ERROR.
  return sameOriginRedirect('/api/facebook/auth');
}
