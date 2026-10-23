'use client';

import { useEffect, useRef, useState } from 'react';

interface AppNotification {
  id: string;
  type: string;
  category: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

interface IncidentDetail {
  id: string;
  source: string;
  platform: string | null;
  category: string;
  decision: string;
  status: 'BLOCKED' | 'UNCERTAIN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED_FALSE_POSITIVE';
  confidence: string | null;
  created_at: string;
  review_note: string | null;
}

const SEVERITY_COLOR: Record<string, string> = { INFO: '#60a5fa', WARNING: '#f59e0b', HIGH: '#f97316', CRITICAL: '#ef4444' };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Warning-detail modal — per spec: neutral tone for UNCERTAIN, never accusatory. */
function IncidentModal({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/moderation/incidents/${incidentId}`)
      .then((r) => { if (!r.ok) throw new Error('Could not load this notice.'); return r.json(); })
      .then((d) => { if (!cancelled) setIncident(d.incident); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this notice.'); });
    return () => { cancelled = true; };
  }, [incidentId]);

  const isUncertain = incident?.status === 'UNCERTAIN';

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(10,14,30,.55)', zIndex: 200, display: 'grid', placeItems: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)', background: '#fff', borderRadius: 16, padding: '24px 26px', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        {error && <p style={{ color: '#b91c1c', fontSize: 13.5 }}>{error}</p>}
        {!incident && !error && <p style={{ fontSize: 13.5, color: '#64748b' }}>Loading…</p>}
        {incident && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 800, color: isUncertain ? '#1d4ed8' : '#991b1b' }}>
              {isUncertain ? 'Content Under Review' : 'Content Policy Violation Detected'}
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 13.5, color: '#374151', lineHeight: 1.5 }}>
              {isUncertain
                ? "We couldn't automatically verify this content. It wasn't published. You can try again, or contact support if this keeps happening."
                : `Your content was flagged for potentially violating our Content Safety Policy and was restricted from publishing.`}
            </p>
            {!isUncertain && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, marginBottom: 14 }}>
                <div><strong>Violation:</strong> {incident.category.replace(/_/g, ' ')}</div>
                <div><strong>Action taken:</strong> Content restricted from publishing</div>
                <div><strong>Source:</strong> {incident.source.replace(/_/g, ' ')}{incident.platform ? ` · ${incident.platform}` : ''}</div>
                <div><strong>Date:</strong> {new Date(incident.created_at).toLocaleString()}</div>
              </div>
            )}
            {!isUncertain && <p style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Please review our content guidelines and avoid uploading or publishing prohibited material. Repeated confirmed violations may result in additional account restrictions.</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <a href="/support" style={{ fontSize: 12.5, fontWeight: 700, color: '#6366f1', textDecoration: 'none', alignSelf: 'center' }}>Content Guidelines</a>
              <button type="button" onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: '#111827', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch('/api/scheduler/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(typeof data.unread === 'number' ? data.unread : 0);
    } catch { /* transient poll failure — try again next tick */ }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try {
      await fetch('/api/scheduler/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch { /* best-effort; next poll will reconcile */ }
  }

  function onNotificationClick(n: AppNotification) {
    if (n.category === 'MODERATION' && typeof n.metadata?.incidentId === 'string') {
      setOpenIncidentId(n.metadata.incidentId);
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="sp-btn sp-btn-ghost"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '44px', height: '44px', display: 'grid', placeItems: 'center', borderRadius: '13px', border: '1px solid rgba(150,242,255,.18)', color: '#C9CDEB' }}
      >
        🔔
      </button>
      {unread > 0 && (
        <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '18px', height: '18px', borderRadius: '50%', background: 'linear-gradient(135deg, #6483FD, #5DAAF5)', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 10px rgba(110,220,255,.8)' }}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}

      {open && (
        <div style={{ position: 'absolute', top: 52, right: 0, width: 340, maxHeight: 420, overflowY: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,.25)', zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>Notifications</span>
            {unread > 0 && <button type="button" onClick={markAllRead} style={{ fontSize: 11.5, fontWeight: 700, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer' }}>Mark all read</button>}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', fontSize: 12.5, color: '#9ca3af' }}>No notifications yet.</div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onNotificationClick(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: '1px solid #f1f5f9',
                  background: n.isRead ? '#fff' : '#f5f7ff', cursor: n.category === 'MODERATION' ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: SEVERITY_COLOR[n.severity] || '#9ca3af', flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111827' }}>{n.title}</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.4 }}>{n.message}</div>
                <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
              </button>
            ))
          )}
        </div>
      )}

      {openIncidentId && <IncidentModal incidentId={openIncidentId} onClose={() => setOpenIncidentId(null)} />}
    </div>
  );
}
