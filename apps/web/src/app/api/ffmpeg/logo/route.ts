import { proxyToGateway } from '@/lib/gateway-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) { return proxyToGateway(request); }
