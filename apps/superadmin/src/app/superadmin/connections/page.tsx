import { callGateway } from '@/lib/gateway-client';
import { relTime, badge } from '../ui';

// Ported from apps/web/src/app/superadmin/connections — the pre-extraction
// monolith page, canonical design for this view (branded per-platform
// cards). Reads GET /api/superadmin/connections (gateway -> admin-service,
// SUPERADMIN-gated).
const PLATFORM_BG: Record<string, string> = {
  Facebook: '#1877f2', Instagram: 'linear-gradient(45deg,#f58529,#dd2a7b,#8134af)',
  LinkedIn: '#0a66c2', 'Whapi (WhatsApp groups)': '#1faa55', Canva: 'linear-gradient(135deg,#00a8b0,#7d2ae8)',
};
const PLATFORM_SHORT: Record<string, string> = { Facebook: 'f', Instagram: 'IG', LinkedIn: 'in', 'Whapi (WhatsApp groups)': 'W', Canva: 'C' };

export default async function SuperadminConnectionsPage() {
  const result = await callGateway<{
    connections: Array<{
      name: string;
      status: 'CONNECTED' | 'NOT_CONNECTED' | 'NOT_TRACKABLE';
      account: string | null;
      detail: string;
      lastPublishAt: string | null;
      connectedUsers: number;
    }>;
  }>('/api/superadmin/connections');
  const connections = result.ok ? result.data.connections : [];

  return (
    <>
      <div style={{ padding: '11px 14px', borderRadius: 11, background: 'var(--acs)', color: 'var(--act)', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
        SocialPulse stores one connection per account per platform. This page is the cross-user admin view; a user only ever sees their own connections at /connect-platforms.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
        {connections.map(c => {
          const st = badge(c.status === 'CONNECTED' ? 'ACTIVE' : c.status === 'NOT_TRACKABLE' ? 'PENDING' : 'SUSPENDED');
          return (
            <div key={c.name} style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: PLATFORM_BG[c.name] || 'var(--ac)', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{PLATFORM_SHORT[c.name] || '?'}</span>
                <span style={{ flex: 1, fontWeight: 800, fontSize: 15 }}>{c.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>
                  {c.status === 'NOT_TRACKABLE' ? 'Not trackable' : c.status === 'CONNECTED' ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
                {c.account && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--bd)' }}>
                    <span style={{ color: 'var(--mu)' }}>Account</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{c.account}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--bd)' }}>
                  <span style={{ color: 'var(--mu)' }}>Accounts connected</span><span style={{ fontWeight: 600 }}>{c.connectedUsers}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--bd)' }}>
                  <span style={{ color: 'var(--mu)' }}>Last publish</span><span style={{ fontWeight: 600 }}>{relTime(c.lastPublishAt)}</span>
                </div>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--mu)', background: 'var(--sf2)', padding: '9px 11px', borderRadius: 9 }}>{c.detail}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
