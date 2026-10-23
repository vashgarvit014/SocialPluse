import { NextResponse } from 'next/server';
import { requireApiSuperadminSession } from '@/lib/session';
import { proxyToGateway } from '@/lib/gateway-client';

// The ONLY way a Super Admin's browser ever reaches flagged media bytes:
// session-verified here, then streamed through the gateway (which itself
// re-checks SUPERADMIN role) to admin-service's short-lived signed-token
// route, which streams from media-service's internal-only route. Never a
// public URL at any point in this chain.
export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await requireApiSuperadminSession();
  if (session instanceof NextResponse) return session;
  const { assetId } = await params;
  const { search } = new URL(request.url);
  return proxyToGateway(request, `/api/admin/moderation/media/${assetId}${search}`);
}
