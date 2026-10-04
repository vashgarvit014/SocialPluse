// Faithful port of src/lib/auth/rate-limit.ts#checkRateLimit — same table
// (rate_limit_counters, already exists, shared with the monolith's own
// auth rate limiting). Fixed-window counter, DB-persisted.
export function createRateLimiter(pool) {
  return async function checkRateLimit(key, limit, windowSeconds) {
    const now = Date.now();
    const { rows } = await pool.query('SELECT count, window_start FROM rate_limit_counters WHERE key = $1', [key]);
    const row = rows[0];
    if (!row || now - new Date(row.window_start).getTime() > windowSeconds * 1000) {
      await pool.query(
        'INSERT INTO rate_limit_counters (key, count, window_start) VALUES ($1, 1, $2) ON CONFLICT (key) DO UPDATE SET count = 1, window_start = excluded.window_start',
        [key, new Date(now).toISOString()],
      );
      return true;
    }
    if (row.count >= limit) return false;
    await pool.query('UPDATE rate_limit_counters SET count = count + 1 WHERE key = $1', [key]);
    return true;
  };
}
