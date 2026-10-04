import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';

// Phase 11 cleanup: this route no longer calls the NVIDIA vision API
// itself — moved to ai-service (services/ai-service/src/vary-image.mjs),
// genuine AI-provider business logic the Phase 7 ai-service extraction
// never covered. Pure proxy now.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:4003';

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${AI_SERVICE_URL}/vary-image`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET || '',
      'x-actor-user-id': session.userId,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
