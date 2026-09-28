import { getAiUsageStats } from '@/lib/ai-usage';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mu)' }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>{value}</span>
      <span style={{ fontSize: 11.5, color: 'var(--mu)' }}>{sub}</span>
    </div>
  );
}

export default async function SuperadminAiUsagePage() {
  const stats = await getAiUsageStats(14);
  const maxDaily = Math.max(1, ...stats.dailyCounts.map(d => d.count));

  return (
    <>
      {!stats.hasData && (
        <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--sf)', border: '1px solid var(--bd)', color: 'var(--mu)', fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: 'var(--tx)' }}>No usage recorded yet.</span> Content/image generation usage is tracked from the moment this was added — nothing is backfilled.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <StatCard label="Content Generations" value={stats.contentGenerations} sub="All time" />
        <StatCard label="Image Generations" value={stats.imageGenerations} sub="All time" />
        <StatCard label="Failed Generations" value={stats.failedGenerations} sub={stats.contentGenerations + stats.imageGenerations > 0 ? `${((stats.failedGenerations / (stats.contentGenerations + stats.imageGenerations)) * 100).toFixed(1)}% of requests` : ''} />
        <StatCard label="Requests Today" value={stats.todayRequests} sub="Since midnight" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 12, alignItems: 'start' }}>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Requests per day</div>
          <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 2 }}>Last 14 days</div>
          {stats.dailyCounts.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 150, marginTop: 14 }}>
              {stats.dailyCounts.map((d, i) => (
                <div key={d.date} title={`${d.date}: ${d.count} requests`} style={{ flex: 1, height: `${Math.round((d.count / maxDaily) * 100)}%`, minHeight: 2, background: i === stats.dailyCounts.length - 1 ? 'var(--ac)' : 'var(--acs)', borderRadius: '5px 5px 2px 2px' }} />
              ))}
            </div>
          ) : (
            <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mu)' }}>No data yet</div>
          )}
        </div>

        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Providers used</div>
          {stats.providers.map(p => (
            <div key={`${p.type}-${p.provider}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid var(--bd)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.failed === 0 ? 'var(--ok)' : p.failed === p.total ? 'var(--bad)' : 'var(--warn)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{p.provider}</div>
                <div style={{ fontSize: 12, color: 'var(--mu)' }}>{p.type === 'CONTENT' ? 'Content' : 'Image'} · {p.total} request{p.total === 1 ? '' : 's'}, {p.failed} failed</div>
              </div>
            </div>
          ))}
          {stats.providers.length === 0 && <div style={{ padding: '14px 0', color: 'var(--mu)', borderTop: '1px solid var(--bd)' }}>No data yet</div>}
        </div>
      </div>
    </>
  );
}
