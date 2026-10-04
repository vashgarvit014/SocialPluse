import Link from 'next/link';
import { callAdminService } from '@/lib/admin-client';
import { absTime, badge } from '../ui';
import PublishActions from './publish-actions';

interface PublishingItem { id: string; userId: string | null; contentPreview: string; platforms: string[]; failedPlatforms: string[] | null; status: string; scheduledAt: string | null; updatedAt: string | null }
interface PublishingCounts { scheduled: number; published: number; failed: number; draft: number }

const TABS: { key: 'scheduled' | 'published' | 'failed' | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
  { key: 'failed', label: 'Failed' },
];
const PLATFORM_BG: Record<string, string> = {
  facebook: '#1877f2', instagram: 'linear-gradient(45deg,#f58529,#dd2a7b,#8134af)', linkedin: '#0a66c2', whatsapp: '#1faa55',
};

export default async function SuperadminPublishingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusParam = 'all' } = await searchParams;
  const status = (['scheduled', 'published', 'failed'] as const).includes(statusParam as 'scheduled') ? (statusParam as 'scheduled' | 'published' | 'failed') : undefined;

  const qs = new URLSearchParams({ limit: '100' });
  if (status) qs.set('status', status);
  const result = await callAdminService<{ items: PublishingItem[]; counts: PublishingCounts }>(`/publishing?${qs.toString()}`);
  if (!result.ok) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>Publishing data is temporarily unavailable. Please try again shortly.</div>;
  }
  const { items, counts } = result.data;
  const tabCounts: Record<string, number> = { all: counts.scheduled + counts.published + counts.failed, scheduled: counts.scheduled, published: counts.published, failed: counts.failed };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const active = t.key === statusParam;
          return (
            <Link
              key={t.key}
              href={`?status=${t.key}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${active ? 'var(--ac)' : 'var(--bd)'}`,
                background: active ? 'var(--acs)' : 'var(--sf)', color: active ? 'var(--act)' : 'var(--tx)',
                borderRadius: 9, padding: '7px 12px', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              {t.label}<span style={{ fontSize: 11, opacity: 0.7 }}>{tabCounts[t.key]}</span>
            </Link>
          );
        })}
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr minmax(0,2fr) 1fr 1fr 220px', gap: 12, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
              <span>PLATFORMS</span><span>POST</span><span>SCHEDULED</span><span>STATUS</span><span style={{ textAlign: 'right' }}>ACTIONS</span>
            </div>
            {items.map(p => {
              const st = badge(p.status === 'pending' ? 'PENDING' : p.status === 'published' ? 'ACTIVE' : p.status === 'failed' ? 'FAILED' : 'PENDING');
              return (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1.1fr minmax(0,2fr) 1fr 1fr 220px', gap: 12, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd)' }}>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {p.platforms.map(pl => (
                      <span key={pl} style={{ width: 22, height: 22, borderRadius: 6, background: PLATFORM_BG[pl] || 'var(--neu)', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title={pl}>
                        {pl.slice(0, 2).toUpperCase()}
                      </span>
                    ))}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.contentPreview || '(no content)'}</div>
                    {p.failedPlatforms && <div style={{ fontSize: 12, color: 'var(--bad)' }}>Failed on: {p.failedPlatforms.join(', ')}</div>}
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>{absTime(p.scheduledAt)}</span>
                  <span><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span></span>
                  <span>{p.status === 'failed' ? <PublishActions postId={p.id} /> : <span style={{ display: 'block', textAlign: 'right', fontSize: 13, color: 'var(--mu)' }}>—</span>}</span>
                </div>
              );
            })}
            {items.length === 0 && <div style={{ padding: 36, textAlign: 'center', color: 'var(--mu)' }}>No posts match this filter.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
