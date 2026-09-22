'use client';

import { useState } from 'react';

type ConnectPlatformsProps = {
  accounts: Array<{ platform: string; connected: boolean; name: string; email: string; userId: string; pages?: Array<{ id: string; name: string }>; pageId?: string }>;
  connectPlatform: (p: string) => void;
  disconnectPlatform: (p: string) => void;
  whapiConnected: boolean;
  whapiChannelStatus: string;
  whapiAccountName: string;
  whapiPhoneMasked: string;
  whapiGroups: Array<{ id: string; name: string; participantsCount: number; type: string }>;
  whapiLoading: boolean;
  whapiGroupsLoading: boolean;
  loadWhapiGroups: () => void;
  startWhatsAppConnect: () => void;
  disconnectWhatsApp: () => void;
  whatsappDisconnecting: boolean;
  canvaConnected: boolean;
  canvaName: string;
  disconnectCanva: () => void;
  refreshWhapiStatus: () => Promise<boolean>;
  refreshCanvaStatus: () => Promise<boolean>;
  platformColors: Record<string, string>;
  PlatformIcon: ({ platform, size }: { platform: string; size?: number }) => React.JSX.Element;
};

function StatusPill({ status }: { status: 'connected' | 'disconnected' | 'connecting' | 'attention' | 'error' }) {
  const map: Record<string, { bg: string; color: string; border: string; dot: string; label: string }> = {
    connected: { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0', dot: '#10b981', label: 'Connected' },
    disconnected: { bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0', dot: '#94a3b8', label: 'Not connected' },
    connecting: { bg: '#fffbeb', color: '#b45309', border: '#fde68a', dot: '#f59e0b', label: 'Connecting' },
    attention: { bg: '#fffbeb', color: '#b45309', border: '#fde68a', dot: '#f59e0b', label: 'Needs Attention' },
    error: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', dot: '#ef4444', label: 'Error' },
  };
  const m = map[status] || map.disconnected;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, backgroundColor: m.bg, color: m.color, border: `1px solid ${m.border}`, padding: '5px 11px', borderRadius: 999 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: m.dot, boxShadow: status === 'connected' ? '0 0 0 3px rgba(16,185,129,0.18)' : 'none' }} />
      {m.label}
    </span>
  );
}

export default function ConnectPlatforms(p: ConnectPlatformsProps) {
  const [refreshing, setRefreshing] = useState(false);

  const linkedinAcc = p.accounts.find(a => a.platform === 'linkedin' && a.connected);
  const fbAcc = p.accounts.find(a => a.platform === 'facebook' && a.connected);
  const igAcc = p.accounts.find(a => a.platform === 'instagram' && a.connected);

  const platformsCount = 5;
  const trueConnected = (p.accounts.some(a => a.platform === 'linkedin' && a.connected) ? 1 : 0) + (p.accounts.some(a => a.platform === 'facebook' && a.connected) ? 1 : 0) + (p.accounts.some(a => a.platform === 'instagram' && a.connected) ? 1 : 0) + (p.whapiConnected ? 1 : 0) + (p.canvaConnected ? 1 : 0);
  const needsAttention = platformsCount - trueConnected;

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        fetch('/api/linkedin/status').then(() => {}).catch(() => {}),
        fetch('/api/facebook/status').then(() => {}).catch(() => {}),
        fetch('/api/instagram/status').then(() => {}).catch(() => {}),
        p.refreshWhapiStatus(),
        p.refreshCanvaStatus(),
      ]);
      if (p.whapiConnected) p.loadWhapiGroups();
    } finally {
      setRefreshing(false);
    }
  };

  const summaryCard = (label: string, value: number, icon: string, bg: string, border: string, color: string, iconBg: string) => (
    <div style={{ flex: 1, minWidth: 140, backgroundColor: bg, border: `1px solid ${border}`, borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2, lineHeight: 1 }}>{value}</div>
      </div>
    </div>
  );

  const featurePanel = (items: string[], tint: string, border: string) => (
    <div style={{ backgroundColor: tint, border: `1px solid ${border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(t => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#334155', fontWeight: 500 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#7C3AED', flexShrink: 0 }} />
          {t}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 18, backgroundColor: '#F7F8FC' }}>
      <style>{`
        .cp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        @media (max-width: 1100px) { .cp-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 640px) { .cp-grid { grid-template-columns: 1fr; } }
        .cp-card { transition: transform 0.18s, box-shadow 0.18s; }
        .cp-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(15,23,42,0.08); }
        .cp-card-connected { box-shadow: 0 1px 3px rgba(15,23,42,0.06); }
        .cp-card-connected .cp-pulse { animation: cpPulse 2s infinite; }
        @keyframes cpPulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.35); } 70% { box-shadow: 0 0 0 8px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
        .cp-refresh-spin { animation: cpSpin 0.8s linear infinite; }
        @keyframes cpSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Hero Header */}
      <div style={{ backgroundColor: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', padding: '20px 22px', display: 'flex', gap: 16, alignItems: 'flex-start', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#EDE9FE,#F5F3FF)', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, color: '#7C3AED' }}>🔗</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>Connect Platforms</div>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 2, fontWeight: 500 }}>Connect and manage the accounts you use with SocialPulse.</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>One place for all your social connections.</div>
        </div>
      </div>

      {/* Summary Cards + Refresh */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, flex: 1, flexWrap: 'wrap' }}>
          {summaryCard('Total Platforms', platformsCount, '🗂️', '#eff6ff', '#dbeafe', '#1e40af', '#dbeafe')}
          {summaryCard('Connected', trueConnected, '✅', '#ecfdf5', '#a7f3d0', '#065f46', '#a7f3d0')}
          {summaryCard('Needs Attention', needsAttention, '⚠️', '#fffbeb', '#fde68a', '#92400e', '#fde68a')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, justifyContent: 'center', minWidth: 160 }}>
          <button onClick={refreshAll} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 12, fontSize: 13, fontWeight: 800, border: 'none', background: refreshing ? '#DDD6FE' : 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: refreshing ? 'wait' : 'pointer', boxShadow: refreshing ? 'none' : '0 4px 14px rgba(124,58,237,0.28)', transition: 'all 0.18s' }}>
            <span className={refreshing ? 'cp-refresh-spin' : ''} style={{ display: 'inline-flex' }}>↻</span> Refresh All
          </button>
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>Sync all platform statuses</span>
        </div>
      </div>

      {/* Platform Grid */}
      <div className="cp-grid">
        {/* LinkedIn */}
        <div className={`cp-card ${linkedinAcc ? 'cp-card-connected' : ''}`} style={{ backgroundColor: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 320 }}>
          <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#0A66C2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: linkedinAcc ? '0 4px 12px rgba(10,102,194,0.25)' : 'none' }}><p.PlatformIcon platform="linkedin" size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>LinkedIn</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Personal profile publishing</div>
            </div>
            <StatusPill status={linkedinAcc ? 'connected' : 'disconnected'} />
          </div>
          <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {linkedinAcc ? (
              <>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{linkedinAcc.name || 'LinkedIn Account'}</div>
                  {linkedinAcc.email && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkedinAcc.email}</div>}
                  <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginTop: 4 }}>Publishing: Personal Profile</div>
                </div>
                {featurePanel(['Share posts and articles', 'Grow your professional network', 'Track engagement performance'], '#f8fafc', '#f1f5f9')}
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>Connect your LinkedIn account to publish directly from SocialPulse.</div>
                {featurePanel(['Share posts and articles', 'Grow your professional network', 'Track engagement performance'], '#f8fafc', '#f1f5f9')}
              </>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14 }}>
              {linkedinAcc ? (
                <>
                  <button onClick={() => p.disconnectPlatform('linkedin')} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>🗑️ Disconnect</button>
                  <button onClick={() => p.connectPlatform('linkedin')} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 800, border: 'none', background: '#0A66C2', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>↺ Reconnect</button>
                </>
              ) : (
                <button onClick={() => p.connectPlatform('linkedin')} style={{ width: '100%', height: 46, borderRadius: 10, fontSize: 13, fontWeight: 800, border: 'none', background: '#0A66C2', color: '#fff', cursor: 'pointer', boxShadow: '0 3px 10px rgba(10,102,194,0.25)' }}>Connect LinkedIn →</button>
              )}
            </div>
          </div>
        </div>

        {/* Facebook */}
        <div className={`cp-card ${fbAcc ? 'cp-card-connected' : ''}`} style={{ backgroundColor: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 320 }}>
          <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#1877F2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: fbAcc ? '0 4px 12px rgba(24,119,242,0.25)' : 'none' }}><p.PlatformIcon platform="facebook" size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Facebook</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Page publishing via Login for Business</div>
            </div>
            <StatusPill status={fbAcc ? 'connected' : 'disconnected'} />
          </div>
          <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fbAcc ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Account: <span style={{ fontWeight: 800 }}>{fbAcc.name || 'Facebook Account'}</span></div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>Selected Page: <span style={{ fontWeight: 700, color: '#0f172a' }}>{(fbAcc.pages?.find(pg => pg.id === fbAcc.pageId) || fbAcc.pages?.[0])?.name || fbAcc.pageId || '—'}</span></div>
                {fbAcc.email && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fbAcc.email}</div>}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>Connect Facebook to enable Page publishing for your brand.</div>
            )}
            {featurePanel(['Publish to Facebook Pages', 'Manage content and comments', 'Access via Facebook Login'], '#f0f9ff', '#dbeafe')}
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14 }}>
              {fbAcc ? (
                <>
                  <button onClick={() => p.disconnectPlatform('facebook')} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>🗑️ Disconnect</button>
                  <button onClick={() => p.connectPlatform('facebook')} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 800, border: 'none', background: '#1877F2', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>↺ Reconnect</button>
                </>
              ) : (
                <button onClick={() => p.connectPlatform('facebook')} style={{ width: '100%', height: 46, borderRadius: 10, fontSize: 13, fontWeight: 800, border: 'none', background: '#1877F2', color: '#fff', cursor: 'pointer', boxShadow: '0 3px 10px rgba(24,119,242,0.25)' }}>Connect Facebook →</button>
              )}
            </div>
          </div>
        </div>

        {/* Instagram */}
        <div className={`cp-card ${igAcc ? 'cp-card-connected' : ''}`} style={{ backgroundColor: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 320 }}>
          <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#E1306C,#833AB4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: igAcc ? '0 4px 12px rgba(225,48,108,0.25)' : 'none' }}><p.PlatformIcon platform="instagram" size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Instagram</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Via Facebook Page</div>
            </div>
            <StatusPill status={igAcc ? 'connected' : fbAcc ? 'attention' : 'disconnected'} />
          </div>
          <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {igAcc ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Account: <span style={{ fontWeight: 800 }}>{(igAcc as any).instagramUsername ? `@${(igAcc as any).instagramUsername}` : igAcc.name || 'Instagram Account'}</span></div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>Connection: Via Facebook • {(fbAcc?.pages?.find(pg => pg.id === fbAcc.pageId) || fbAcc?.pages?.[0])?.name || 'SocialPulse'}</div>
              </div>
            ) : fbAcc ? (
              <div style={{ fontSize: 12, color: '#92400e', backgroundColor: '#fffbeb', border: '1px solid #fde68a', padding: '10px 12px', borderRadius: 10, lineHeight: 1.5 }}>Facebook connected but no Instagram Professional account linked to the selected Page.</div>
            ) : (
              <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>Connect Facebook first, then link an Instagram Professional account to your Page.</div>
            )}
            {featurePanel(['Publish photos, videos and reels', 'Manage comments and DMs', 'Track performance and insights'], '#fdf2f8', '#fce7f3')}
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14 }}>
              {igAcc ? (
                <>
                  <button onClick={() => p.disconnectPlatform('instagram')} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>🗑️ Disconnect</button>
                  <button onClick={() => p.connectPlatform('instagram')} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#E1306C,#833AB4)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>↺ Reconnect</button>
                </>
              ) : (
                <button onClick={() => p.connectPlatform('facebook')} style={{ width: '100%', height: 46, borderRadius: 10, fontSize: 13, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#E1306C,#833AB4)', color: '#fff', cursor: 'pointer', boxShadow: '0 3px 10px rgba(225,48,108,0.25)' }}>{fbAcc ? 'Connect Instagram →' : 'Connect Facebook first →'}</button>
              )}
            </div>
          </div>
        </div>

        {/* WhatsApp */}
        <div className={`cp-card ${p.whapiConnected ? 'cp-card-connected' : ''}`} style={{ backgroundColor: '#fff', borderRadius: 18, border: p.whapiConnected ? '1px solid #a7f3d0' : '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 360 }}>
          <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid #f1f5f9', background: p.whapiConnected ? 'linear-gradient(180deg,#f0fdf4,#fff)' : '#fff' }}>
            <div className={p.whapiConnected ? 'cp-pulse' : ''} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, boxShadow: p.whapiConnected ? '0 4px 12px rgba(37,211,102,0.25)' : 'none' }}>💬</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>WhatsApp</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Direct messaging • Existing groups</div>
            </div>
            <StatusPill status={p.whapiConnected ? 'connected' : 'disconnected'} />
          </div>
          <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {p.whapiConnected ? (
              <>
                <div style={{ backgroundColor: p.whapiChannelStatus === 'AUTH' ? '#ecfdf5' : '#fffbeb', border: `1px solid ${p.whapiChannelStatus === 'AUTH' ? '#a7f3d0' : '#fde68a'}`, borderRadius: 10, padding: '9px 11px', fontSize: 11 }}>
                  <div style={{ color: '#64748b', fontWeight: 600, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>Connection</div>
                  <div style={{ fontWeight: 700, color: p.whapiChannelStatus === 'AUTH' ? '#059669' : '#b45309', marginTop: 2 }}>{p.whapiChannelStatus === 'AUTH' ? 'Connected' : p.whapiChannelStatus || '—'}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{p.whapiAccountName || 'WhatsApp Account'}{p.whapiPhoneMasked ? <span style={{ fontWeight: 500, color: '#64748b' }}> • {p.whapiPhoneMasked}</span> : ''}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>Available Chats: <span style={{ fontWeight: 800, color: '#0f172a' }}>{p.whapiGroups.length || '—'}</span> {p.whapiLoading ? '(checking…)' : ''}</div>
                {p.whapiGroups.length > 0 && (
                  <div style={{ backgroundColor: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase' as const, marginBottom: 6 }}>Recent chats</div>
                    {p.whapiGroups.slice(0, 3).map(g => (
                      <div key={g.id} style={{ fontSize: 11, color: '#334155', fontWeight: 500, padding: '3px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {g.name}</div>
                    ))}
                    {p.whapiGroups.length > 3 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>+{p.whapiGroups.length - 3} more</div>}
                  </div>
                )}
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46' }}>WhatsApp capabilities</div>
                  {['Send and receive messages', 'Manage your groups', 'Automate notifications', 'Keep your community engaged'].map(t => (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#065f46', fontWeight: 500 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#10b981', flexShrink: 0 }} /> {t}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Connect your WhatsApp account by scanning a QR code.</div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>Link your device once — SocialPulse will use the Whapi session to publish to your existing groups.</div>
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {['Send and receive messages', 'Manage your groups', 'Automate notifications', 'Keep your community engaged'].map(t => (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#065f46', fontWeight: 500 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#10b981', flexShrink: 0 }} /> {t}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14 }}>
              {p.whapiConnected ? (
                <>
                  <button onClick={() => p.loadWhapiGroups()} disabled={p.whapiGroupsLoading} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid #e2e8f0', backgroundColor: '#fff', color: p.whapiGroupsLoading ? '#94a3b8' : '#334155', cursor: p.whapiGroupsLoading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{p.whapiGroupsLoading ? 'Refreshing…' : '↻ Refresh Chats'}</button>
                  <button onClick={() => p.disconnectWhatsApp()} disabled={p.whatsappDisconnecting} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: p.whatsappDisconnecting ? 'wait' : 'pointer', opacity: p.whatsappDisconnecting ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>🗑️ Disconnect</button>
                </>
              ) : (
                <button onClick={() => p.startWhatsAppConnect()} disabled={p.whapiLoading} style={{ width: '100%', height: 46, borderRadius: 10, fontSize: 13, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff', cursor: p.whapiLoading ? 'wait' : 'pointer', boxShadow: '0 3px 10px rgba(37,211,102,0.25)' }}>Connect WhatsApp →</button>
              )}
            </div>
          </div>
        </div>

        {/* Canva */}
        <div className={`cp-card ${p.canvaConnected ? 'cp-card-connected' : ''}`} style={{ backgroundColor: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 320 }}>
          <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#00C4CC,#7C3AED)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontStyle: 'italic', fontFamily: 'Georgia, serif', flexShrink: 0, boxShadow: p.canvaConnected ? '0 4px 12px rgba(0,196,204,0.25)' : 'none' }}>C</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Canva</div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Design integration</div>
            </div>
            <StatusPill status={p.canvaConnected ? 'connected' : 'disconnected'} />
          </div>
          <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {p.canvaConnected ? (
              <div style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>● Connected{p.canvaName ? ` as ${p.canvaName}` : ''}</div>
            ) : null}
            <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>{p.canvaConnected ? 'Create, edit and import Canva designs into SocialPulse.' : 'Connect Canva to create, edit and import designs for your social content.'}</div>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {['Create stunning designs', 'Access your templates', 'Import designs into SocialPulse', 'Streamline your content workflow'].map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#334155', fontWeight: 500 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#7C3AED', flexShrink: 0 }} /> {t}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14 }}>
              {p.canvaConnected ? (
                <>
                  <button onClick={() => p.connectPlatform('canva')} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#334155', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>↺ Reconnect</button>
                  <button onClick={() => p.disconnectCanva()} style={{ flex: 1, height: 44, borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>🗑️ Disconnect</button>
                </>
              ) : (
                <button onClick={() => p.connectPlatform('canva')} style={{ width: '100%', height: 46, borderRadius: 10, fontSize: 13, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#00C4CC,#7C3AED)', color: '#fff', cursor: 'pointer', boxShadow: '0 3px 10px rgba(0,196,204,0.28)' }}>Connect Canva →</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b', backgroundColor: '#fff', border: '1px solid #e2e8f0', padding: '8px 12px', borderRadius: 999 }}>
          <span style={{ fontSize: 13 }}>🛡️</span> Tokens and secrets stay server-side. This page only shows safe account info and connection state.
        </div>
        <a href="https://socialpulse.dotstark.tech/privacy" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#7C3AED', fontWeight: 700, textDecoration: 'none' }}>Need help? View our documentation →</a>
      </div>
    </div>
  );
}
