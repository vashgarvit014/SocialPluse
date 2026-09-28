import { getSystemHealth } from '@/lib/auth/system-health';
import { badge } from '../ui';
import RefreshButton from './refresh-button';

const COUNT_COLOR: Record<string, string> = { Healthy: 'var(--ok)', 'Not configured': 'var(--neu)', Error: 'var(--bad)' };

export default async function SuperadminSystemHealthPage() {
  const checks = await getSystemHealth();
  const healthy = checks.filter(c => c.status === 'OK').length;
  const notConfigured = checks.filter(c => c.status === 'NOT_CONFIGURED').length;
  const errored = checks.filter(c => c.status === 'ERROR').length;
  const checkedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['Healthy', healthy], ['Not configured', notConfigured], ['Error', errored]].map(([label, n]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 9, padding: '7px 12px', fontSize: 13, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COUNT_COLOR[label] }} />{label}<span style={{ fontWeight: 800 }}>{n}</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--mu)' }}>Checked at {checkedAt}</span>
          <RefreshButton />
        </div>
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 130px 2fr 100px', gap: 12, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
              <span>SERVICE</span><span>STATUS</span><span>DETAIL</span><span>CHECKED</span>
            </div>
            {checks.map(c => {
              const st = badge(c.status);
              return (
                <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '1.2fr 130px 2fr 100px', gap: 12, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd)' }}>
                  <span style={{ fontWeight: 700 }}>{c.name}</span>
                  <span><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span></span>
                  <span style={{ fontSize: 13 }}>{c.detail}</span>
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>Just now</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mu)', lineHeight: 1.5 }}>
        Checks are lightweight: a database query plus configuration checks for each integration. External provider APIs are never called just to render this page. Credentials are never shown.
      </div>
    </>
  );
}
