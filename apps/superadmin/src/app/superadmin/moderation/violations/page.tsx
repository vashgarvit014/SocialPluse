import { relTime, badge } from '../../ui';
import { callAdminService as callAdminGateway } from '@/lib/admin-client';

export const dynamic = 'force-dynamic';

interface Incident {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  source: string;
  platform: string | null;
  category: string;
  decision: string;
  status: string;
  confidence: string | null;
  method: string;
  content_preview: string | null;
  media_asset_id: string | null;
  media_restricted: boolean;
  created_at: string;
}

interface Stats {
  total: number;
  blocked: number;
  uncertain: number;
  recent: number;
  byCategory: Array<{ category: string; count: number }>;
  repeatOffenders: Array<{ userId: string; name: string; email: string; count: number }>;
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mu)', letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: tone || 'var(--act)' }}>{value}</div>
    </div>
  );
}

function statusTone(status: string): { bg: string; fg: string } {
  if (status === 'BLOCKED') return badge('SUSPENDED');
  if (status === 'UNCERTAIN') return badge('PENDING');
  if (status === 'RESOLVED' || status === 'DISMISSED_FALSE_POSITIVE') return badge('ACTIVE');
  return badge('PENDING'); // UNDER_REVIEW
}

export default async function ViolationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.status) qs.set('status', sp.status);
  if (sp.category) qs.set('category', sp.category);
  if (sp.source) qs.set('source', sp.source);
  if (sp.q) qs.set('userId', sp.q);

  const [statsRes, listRes] = await Promise.all([
    callAdminGateway('/moderation/violations/stats'),
    callAdminGateway(`/moderation/violations?${qs.toString()}`),
  ]);

  const stats = (statsRes.ok ? (statsRes.data as { stats: Stats }).stats : null);
  const list = (listRes.ok ? (listRes.data as { incidents: Incident[]; total: number }) : null);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <a href="/superadmin/moderation" style={{ fontSize: 12.5, fontWeight: 700, color: '#6b5cf6', textDecoration: 'none' }}>← Flagged Users</a>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Content Violations</h1>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatTile label="Total Incidents" value={stats.total} />
          <StatTile label="Blocked" value={stats.blocked} tone={stats.blocked ? '#c0352c' : undefined} />
          <StatTile label="Uncertain" value={stats.uncertain} tone={stats.uncertain ? '#b7791f' : undefined} />
          <StatTile label="Last 7 Days" value={stats.recent} />
        </div>
      )}

      {stats && stats.repeatOffenders.length > 0 && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Repeat Offenders</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {stats.repeatOffenders.slice(0, 10).map((u) => (
              <a key={u.userId} href={`/superadmin/moderation/violations?q=${u.userId}`} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999, background: 'var(--sf2)', color: 'var(--tx)', textDecoration: 'none', fontWeight: 700 }}>
                {u.name} ({u.count})
              </a>
            ))}
          </div>
        </div>
      )}

      <form style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select name="status" defaultValue={sp.status || ''} style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid var(--bd)', fontSize: 12.5 }}>
          <option value="">All statuses</option>
          {['BLOCKED', 'UNCERTAIN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED_FALSE_POSITIVE'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="source" defaultValue={sp.source || ''} style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid var(--bd)', fontSize: 12.5 }}>
          <option value="">All sources</option>
          {['ASSET_GALLERY_UPLOAD', 'AI_GENERATION', 'DIRECT_PUBLISH', 'SCHEDULED_PUBLISH'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <button type="submit" style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#6b5cf6', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Filter</button>
      </form>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        {!list || list.incidents.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 13 }}>No violations recorded yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--sf2)' }}>
                {['User', 'Source', 'Platform', 'Category', 'Status', 'When', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.incidents.map((i) => {
                const st = statusTone(i.status);
                return (
                  <tr key={i.id} style={{ borderTop: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 700 }}>{i.user_name}<div style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 400 }}>{i.user_email}</div></td>
                    <td style={{ padding: '12px 14px', color: 'var(--mu)' }}>{i.source.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--mu)' }}>{i.platform || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>{i.category.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg }}>{i.status.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--mu)', whiteSpace: 'nowrap' }}>{relTime(i.created_at)}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <a href={`/superadmin/moderation/violations/${i.id}`} style={{ fontSize: 11.5, fontWeight: 800, color: '#6b5cf6', textDecoration: 'none' }}>Review</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
