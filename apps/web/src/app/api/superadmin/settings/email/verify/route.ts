import { proxyToGateway } from '@/lib/gateway-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return proxyToGateway(request); }
export async function POST(request: Request) { return proxyToGateway(request); }
export async function PATCH(request: Request) { return proxyToGateway(request); }
export async function DELETE(request: Request) { return proxyToGateway(request); }
