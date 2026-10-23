import { proxyToGateway } from '@/lib/gateway-proxy';

export const dynamic = 'force-dynamic';

// Pure passthrough — the gateway forwards to user-service's actor-scoped
// /moderation/incidents/:id/self route, which enforces that a user can
// only ever fetch their OWN incident. No userId is ever accepted from the
// client; it's derived server-side from the session on every hop.
export async function GET(request: Request) { return proxyToGateway(request); }
