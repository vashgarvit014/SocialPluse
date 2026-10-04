import 'server-only';
import { query, queryOne } from '@/lib/db';

// Server-side workspace draft persistence. Unlike the localStorage autosave
// (which strips images past ~4MB and sets mediaSkipped), the server copy
// keeps the full draft including image/video data URLs, so "Keep my content"
// restores the previous image instead of dropping it. One row per user
// (latest workspace state); 25MB cap guards against abuse.
const MAX_DRAFT_BYTES = 25_000_000;

export function isStorableDraft(draft: unknown): boolean {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
  try {
    return JSON.stringify(draft).length <= MAX_DRAFT_BYTES;
  } catch {
    return false;
  }
}

export async function saveEditorDraft(userId: string, draft: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO editor_drafts (user_id, draft, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = EXCLUDED.updated_at`,
    [userId, JSON.stringify(draft), now],
  );
}

export async function loadEditorDraft(userId: string): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ draft: unknown }>('SELECT draft FROM editor_drafts WHERE user_id = $1', [userId]);
  if (!row || !row.draft || typeof row.draft !== 'object' || Array.isArray(row.draft)) return null;
  return row.draft as Record<string, unknown>;
}

export async function clearEditorDraft(userId: string): Promise<void> {
  await query('DELETE FROM editor_drafts WHERE user_id = $1', [userId]);
}
