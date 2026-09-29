import 'server-only';
import { query, queryOne } from '@/lib/db';

// Fixed-window counter, persisted in PostgreSQL (not in-memory) so limits
// survive a restart/redeploy and apply consistently across the app
// container. Key convention: "<action>:<dimension>:<value>", e.g.
// "otp_request:ip:1.2.3.4" or "login:email:user@example.com" — callers
// check every dimension they care about (IP, email, mobile, challengeId)
// as separate keys.
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Date.now();
  const row = await queryOne<{ count: number; window_start: string }>(
    'SELECT count, window_start FROM rate_limit_counters WHERE key = $1', [key],
  );

  if (!row || now - new Date(row.window_start).getTime() > windowSeconds * 1000) {
    await query(
      'INSERT INTO rate_limit_counters (key, count, window_start) VALUES ($1, 1, $2) ON CONFLICT (key) DO UPDATE SET count = 1, window_start = excluded.window_start',
      [key, new Date(now).toISOString()],
    );
    return true;
  }

  if (row.count >= limit) return false;

  await query('UPDATE rate_limit_counters SET count = count + 1 WHERE key = $1', [key]);
  return true;
}

// How long until this key's window resets — 0 when the caller is not
// currently limited. Lets a 429 tell the client *when* it may try again
// instead of a dead "too many requests, please wait" with no way forward.
export async function rateLimitRetryMs(key: string, windowSeconds: number): Promise<number> {
  const row = await queryOne<{ count: number; window_start: string }>(
    'SELECT count, window_start FROM rate_limit_counters WHERE key = $1', [key],
  );
  if (!row) return 0;
  const resetsInMs = new Date(row.window_start).getTime() + windowSeconds * 1000 - Date.now();
  return resetsInMs > 0 ? resetsInMs : 0;
}
