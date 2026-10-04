import { callAdminService } from '@/lib/admin-client';
import { relTime } from '../ui';

interface AdminAuditEvent { id: string; event: string; targetUserName: string | null; targetUserEmail: string | null; createdAt: string; meta: { postId?: string } | null }

export default async function SuperadminAuditLogsPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const { search = '' } = await searchParams;
  const qs = new URLSearchParams({ limit: '150' });
  if (search) qs.set('search', search);
  const result = await callAdminService<{ events: AdminAuditEvent[] }>(`/audit-logs?${qs.toString()}`);
  if (!result.ok) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>Audit log data is temporarily unavailable. Please try again shortly.</div>;
  }
  const events = result.data.events;

  return (
    <>
      <form method="GET" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 9, padding: '0 12px', height: 36, flex: '0 1 320px', minWidth: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--mu)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="text" name="search" defaultValue={search} placeholder="Search target user" style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, minWidth: 0, height: 34 }} />
        </label>
        <span style={{ fontSize: 12, color: 'var(--mu)' }}>Superadmin-initiated actions. Login/OTP events live in Auth Activity.</span>
      </form>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.8fr 1fr', gap: 12, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
              <span>ACTION</span><span>TARGET</span><span>TIME</span>
            </div>
            {events.map(e => (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.8fr 1fr', gap: 12, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd)' }}>
                <span style={{ fontWeight: 700 }}>{e.event.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 13, color: 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.targetUserName ? `${e.targetUserName} (${e.targetUserEmail})` : (e.meta?.postId ? `Post ${e.meta.postId}` : '—')}
                </span>
                <span style={{ fontSize: 13, color: 'var(--mu)' }}>{relTime(e.createdAt)}</span>
              </div>
            ))}
            {events.length === 0 && <div style={{ padding: 36, textAlign: 'center', color: 'var(--mu)' }}>No actions recorded.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
