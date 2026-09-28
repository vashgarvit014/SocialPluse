import Link from 'next/link';
import { listSystemLogs, LOG_PAGE_SIZE } from '@/lib/system-log-reader';
import LogsTable from './logs-table';

const CATEGORIES = ['ALL', 'AUTH', 'USER', 'AI', 'MEDIA', 'PUBLISHING', 'PLATFORM', 'SYSTEM'];
const LEVELS = ['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'];
const PLATFORMS = ['ALL', 'linkedin', 'facebook', 'instagram', 'whatsapp', 'canva'];
const RANGES = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'custom', label: 'Custom range' },
];

function rangeToDates(range: string, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (range === 'today') return { from: new Date(now.setHours(0, 0, 0, 0)).toISOString() };
  if (range === '24h') return { from: new Date(Date.now() - 24 * 3600 * 1000).toISOString() };
  if (range === '7d') return { from: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString() };
  if (range === 'custom') {
    const out: { from?: string; to?: string } = {};
    if (from) {
      const d = new Date(from);
      if (Number.isFinite(d.getTime())) out.from = d.toISOString();
    }
    if (to) {
      const d = new Date(to);
      if (Number.isFinite(d.getTime())) out.to = d.toISOString();
    }
    return out;
  }
  return {};
}

export default async function SuperadminLogsPage({ searchParams }: {
  searchParams: Promise<{ category?: string; level?: string; platform?: string; q?: string; range?: string; from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const category = CATEGORIES.includes((sp.category || '').toUpperCase()) ? (sp.category as string).toUpperCase() : 'ALL';
  const level = LEVELS.includes((sp.level || '').toUpperCase()) ? (sp.level as string).toUpperCase() : 'ALL';
  const platform = PLATFORMS.includes((sp.platform || '').toLowerCase()) ? (sp.platform as string).toLowerCase() : 'ALL';
  const q = (sp.q || '').slice(0, 100);
  const range = RANGES.some(r => r.key === sp.range) ? (sp.range as string) : 'all';
  const pageNum = Math.max(Number(sp.page) || 1, 1);

  const { from, to } = rangeToDates(range, sp.from || '', sp.to || '');
  const { rows, total } = await listSystemLogs({
    category, level, platform,
    q: q || undefined, from, to,
    limit: LOG_PAGE_SIZE, offset: (pageNum - 1) * LOG_PAGE_SIZE,
  });
  const totalPages = Math.max(Math.ceil(total / LOG_PAGE_SIZE), 1);

  const qs = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({ category, level, platform, q, range, from: sp.from || '', to: sp.to || '', ...overrides });
    for (const k of ['q', 'from', 'to']) if (!p.get(k)) p.delete(k);
    return `?${p.toString()}`;
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 9,
    padding: '0 12px', height: 36, fontSize: 13, color: 'var(--tx)', outline: 'none',
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => {
          const active = c === category;
          return (
            <Link
              key={c}
              href={qs({ category: c, page: '1' })}
              style={{
                display: 'flex', alignItems: 'center', border: `1px solid ${active ? 'var(--ac)' : 'var(--bd)'}`,
                background: active ? 'var(--acs)' : 'var(--sf)', color: active ? 'var(--act)' : 'var(--tx)',
                borderRadius: 9, padding: '7px 12px', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
                textTransform: 'capitalize',
              }}
            >
              {c === 'ALL' ? 'All' : c.charAt(0) + c.slice(1).toLowerCase() + (c === 'USER' ? 's' : c === 'PLATFORM' ? 's' : '')}
            </Link>
          );
        })}
      </div>

      <form method="GET" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="page" value="1" />
        <select name="level" defaultValue={level} style={inputStyle} aria-label="Level filter">
          {LEVELS.map(l => <option key={l} value={l}>{l === 'ALL' ? 'Level: All' : l.charAt(0) + l.slice(1).toLowerCase()}</option>)}
        </select>
        <select name="platform" defaultValue={platform} style={inputStyle} aria-label="Platform filter">
          {PLATFORMS.map(p => <option key={p} value={p}>{p === 'ALL' ? 'Platform: All' : p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>
        <select name="range" defaultValue={range} style={inputStyle} aria-label="Date range">
          {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {range === 'custom' && (
          <>
            <input type="datetime-local" name="from" defaultValue={sp.from || ''} style={inputStyle} aria-label="From" />
            <input type="datetime-local" name="to" defaultValue={sp.to || ''} style={inputStyle} aria-label="To" />
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 9, padding: '0 12px', height: 36, flex: '0 1 280px', minWidth: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--mu)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="text" name="q" defaultValue={q} placeholder="Search event, user, email, message, resource" style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, minWidth: 0, height: 34, color: 'var(--tx)' }} />
        </label>
        <button type="submit" style={{ height: 36, padding: '0 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, var(--ac), var(--act))', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          Apply
        </button>
      </form>

      <div style={{ fontSize: 12.5, color: 'var(--mu)' }}>{total} matching log{total === 1 ? '' : 's'} • newest first • 50 per page</div>

      <LogsTable rows={rows} />

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Array.from({ length: Math.min(totalPages, 20) }, (_, i) => i + 1).map(p => (
            <Link
              key={p}
              href={qs({ page: String(p) })}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none',
                color: p === pageNum ? '#fff' : 'var(--tx)', background: p === pageNum ? 'var(--ac)' : 'var(--sf)', border: '1px solid var(--bd)',
              }}
            >
              {p}
            </Link>
          ))}
          {totalPages > 20 && <span style={{ fontSize: 12, color: 'var(--mu)', alignSelf: 'center' }}>… {totalPages} pages total, refine filters to narrow</span>}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--mu)', lineHeight: 1.5 }}>
        Retention: logs are kept indefinitely for now — no automatic deletion runs. Sources: new structured events (system_logs) plus mapped history (auth_audit_logs, ai_usage_log). Secrets are redacted before storage.
      </div>
    </>
  );
}
