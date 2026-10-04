import { proxyToGateway } from '@/lib/gateway-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return proxyToGateway(request); }
