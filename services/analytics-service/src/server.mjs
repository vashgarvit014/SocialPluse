import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool, types } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { verifyInternalSecret } from '../packages/service-auth/index.mjs';

// analytics-service — logically owns the `ai_usage_log` table on the shared
// Postgres instance (single-Postgres-server strategy: schema/table
// ownership is logical, not a separate database per service, for this first
// migration pass). Read-only: nothing here writes ai_usage_log — rows are
// still inserted by the monolith's generate-content/generate-image routes,
// which keeps this extraction additive and risk-free to the existing write
// path.
//
// This does NOT replace /api/superadmin/ai-usage in the monolith yet - that
// route keeps working unchanged. This service is reachable only through the
// new gateway at /api/analytics/ai-usage, proving the extraction pattern
// without touching the live Superadmin UI's existing call path.

const PORT = Number(process.env.PORT || 4008);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const log = createLogger('analytics-service');

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.error({ event: 'pool_error', message: err.message }));
  return pool;
}

async function getAiUsageStats(days = 14) {
  const db = getPool();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const totals = await db.query(
    `SELECT
       count(*) FILTER (WHERE type = 'CONTENT') AS content,
       count(*) FILTER (WHERE type = 'IMAGE') AS image,
       count(*) FILTER (WHERE success = false) AS failed,
       count(*) FILTER (WHERE created_at >= $1) AS today
     FROM ai_usage_log`,
    [todayStart],
  );
  const dailyRows = await db.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS count
     FROM ai_usage_log WHERE created_at >= $1 GROUP BY 1 ORDER BY 1 ASC`,
    [since],
  );
  const providerRows = await db.query(
    `SELECT provider, type, count(*) AS total, count(*) FILTER (WHERE success = false) AS failed
     FROM ai_usage_log GROUP BY provider, type ORDER BY type, provider`,
  );
  const anyRow = await db.query('SELECT EXISTS(SELECT 1 FROM ai_usage_log) AS exists');

  const t = totals.rows[0] || {};
  return {
    contentGenerations: Number(t.content ?? 0),
    imageGenerations: Number(t.image ?? 0),
    failedGenerations: Number(t.failed ?? 0),
    todayRequests: Number(t.today ?? 0),
    hasData: !!anyRow.rows[0]?.exists,
    dailyCounts: dailyRows.rows.map((r) => ({ date: r.day, count: Number(r.count) })),
    providers: providerRows.rows.map((r) => ({ provider: r.provider, type: r.type, total: Number(r.total), failed: Number(r.failed) })),
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  if (req.url === '/health') {
    return send(res, 200, { service: 'analytics-service', status: 'ok', timestamp: new Date().toISOString() });
  }

  if (req.url === '/ai-usage' && req.method === 'GET') {
    if (!verifyInternalSecret(req, INTERNAL_SECRET)) {
      return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
    }
    try {
      const stats = await getAiUsageStats();
      return send(res, 200, stats);
    } catch (err) {
      log.error({ requestId, event: 'ai_usage_query_failed', message: err instanceof Error ? err.message : 'unknown' });
      return send(res, 503, { code: 'ANALYTICS_UNAVAILABLE', message: 'Analytics are temporarily unavailable.' });
    }
  }

  return send(res, 404, { code: 'NOT_FOUND', message: 'No such analytics-service route.' });
});

server.listen(PORT, () => log.info({ event: 'listening', port: PORT }));

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then close the DB pool. No background jobs here to cancel.
function shutdown(signal) {
  log.info({ event: 'shutdown_start', signal });
  server.close(() => {
    (pool ? pool.end() : Promise.resolve()).finally(() => {
      log.info({ event: 'shutdown_complete' });
      process.exit(0);
    });
  });
  // Don't hang forever if a connection never closes.
  setTimeout(() => process.exit(1), 10_000).unref();
}
// Safety net found necessary by a real crash during testing elsewhere in
// this migration (publishing-service): an uncaught async error anywhere
// in a request handler is a Node process-level unhandledRejection by
// default, which CRASHES the whole service — taking down every other
// in-flight request too, not just the one that errored. Log and survive.
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
