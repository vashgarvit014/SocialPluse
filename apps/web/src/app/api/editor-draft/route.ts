import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { saveEditorDraft, loadEditorDraft, clearEditorDraft, isStorableDraft } from '@/lib/editor-draft';

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const draft = await loadEditorDraft(session.userId);
  return NextResponse.json({ draft });
}

export async function PUT(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const draft = (body as { draft?: unknown })?.draft;
  if (!isStorableDraft(draft)) {
    return NextResponse.json({ error: 'Draft is missing or exceeds the 25MB limit.' }, { status: 413 });
  }
  await saveEditorDraft(session.userId, draft as Record<string, unknown>);
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  await clearEditorDraft(session.userId);
  return NextResponse.json({ success: true });
}
