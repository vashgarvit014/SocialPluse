import { proxyToGateway } from '@/lib/gateway-proxy';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return proxyToGateway(request); }
export async function PUT(request: Request) { return proxyToGateway(request, undefined, { streamBody: true }); }
export async function DELETE(request: Request) { return proxyToGateway(request); }
