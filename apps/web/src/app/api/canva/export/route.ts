import { proxyToGateway } from '@/lib/gateway-proxy';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) { return proxyToGateway(request); }
