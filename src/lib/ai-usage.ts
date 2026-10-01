import 'server-only';
import { randomUUID } from 'node:crypto';
import { query, queryOne } from '@/lib/db';

export type AiUsageType = 'CONTENT' | 'IMAGE';

// Fire-and-forget, same pattern as logAuthEvent — a lost usage row must
// never fail or delay the actual generation request.
//
// userId makes the row attributable. The column was added nullable and is NOT
// backfilled: usage recorded before ownership existed cannot be honestly
// assigned to anyone, so those rows stay NULL rather than being credited to
// whichever account happens to exist now.
export function recordAiUsage(params: { type: AiUsageType; provider: string; success: boolean; durationMs?: number; userId?: string | null }): void {
  query(
    'INSERT INTO ai_usage_log (id, user_id, type, provider, success, duration_ms, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [randomUUID(), params.userId ?? null, params.type, params.provider, params.success, params.durationMs ?? null, new Date().toISOString()],
  ).catch((error) => {
    console.error('[ai-usage] failed to record usage:', error instanceof Error ? error.message : 'unknown error');
  });
}

export interface AiUsageStats {
  contentGenerations: number;
  imageGenerations: number;
  failedGenerations: number;
  todayRequests: number;
  hasData: boolean;
  dailyCounts: { date: string; count: number }[];
  providers: { provider: string; type: AiUsageType; total: number; failed: number }[];
}

// Counts only what's been recorded since this table started existing —
// deliberately not backfilled with anything for the period before that (no
// historical usage data exists), so a fresh deploy legitimately starts at
// zero rather than showing a fabricated number.
export async function getAiUsageStats(days = 14): Promise<AiUsageStats> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const totals = await queryOne<{ content: string; image: string; failed: string; today: string }>(`
    SELECT
      count(*) FILTER (WHERE type = 'CONTENT') AS content,
      count(*) FILTER (WHERE type = 'IMAGE') AS image,
      count(*) FILTER (WHERE success = false) AS failed,
      count(*) FILTER (WHERE created_at >= $1) AS today
    FROM ai_usage_log
  `, [todayStart]);

  const dailyRows = await query<{ day: string; count: string }>(`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS count
    FROM ai_usage_log
    WHERE created_at >= $1
    GROUP BY 1 ORDER BY 1 ASC
  `, [since]);

  const providerRows = await query<{ provider: string; type: AiUsageType; total: string; failed: string }>(`
    SELECT provider, type, count(*) AS total, count(*) FILTER (WHERE success = false) AS failed
    FROM ai_usage_log
    GROUP BY provider, type ORDER BY type, provider
  `);

  const anyRow = await queryOne<{ exists: boolean }>('SELECT EXISTS(SELECT 1 FROM ai_usage_log) AS exists');

  return {
    contentGenerations: Number(totals?.content ?? 0),
    imageGenerations: Number(totals?.image ?? 0),
    failedGenerations: Number(totals?.failed ?? 0),
    todayRequests: Number(totals?.today ?? 0),
    hasData: !!anyRow?.exists,
    dailyCounts: dailyRows.map(r => ({ date: r.day, count: Number(r.count) })),
    providers: providerRows.map(r => ({ provider: r.provider, type: r.type, total: Number(r.total), failed: Number(r.failed) })),
  };
}
