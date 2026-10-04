'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Notification {
  id: string;
  type: string;
  category: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  userId: string | null;
  userEmail: string | null;
  isRead: boolean;
  createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  INFO: '#3b82f6',
  WARNING: '#b7791f',
  HIGH: '#c0352c',
  CRITICAL: '#7f1d1d',
};

function rel(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Superadmin notification bell.
 *
 * Reads from /api/superadmin/notifications (PostgreSQL-backed). Polls while
 * open so a freshly-flagged account surfaces without a manual reload. The
 * Cloudflare tunnel in front of the app is transport only — it is not the
 * notification system and is never consulted for alerting.
 */
export default function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
    } catch {
      /* transient — next poll retries */
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on open from the toggle handler (an event callback), NOT from the
  // effect body: synchronously calling load() inside an effect setState would
  // cascade a render on mount. The effect below only owns the polling timer,
  // which is the correct "subscribe to an external system" shape.
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }

  // Light polling only while the panel is open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => void load(), 20000);
    return () => clearInterval(id);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function markAll() {
    await fetch('/api/superadmin/notifications', { method: 'POST' }).catch(() => {});
    void load();
  }

  async function review(n: Notification) {
    if (!n.isRead) await fetch(`/api/superadmin/notifications/${n.id}`, { method: 'POST' }).catch(() => {});
    setOpen(false);
    // Moderation alerts go straight to the review surface; everything else to
    // the monitoring area.
    router.push(n.category === 'MODERATION' && n.userId ? `/superadmin/users/${n.userId}` : '/superadmin/moderation');
    router.refresh();
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        style={{
          width: 38, height: 38, borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--sf)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px',
              borderRadius: 999, background: '#c0352c', color: '#fff', fontSize: 10, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 'min(400px, calc(100vw - 32px))',
            background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, boxShadow: '0 20px 54px rgba(0,0,0,0.28)',
            overflow: 'hidden', zIndex: 60,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--bd)' }}>
            <strong style={{ flex: 1, fontSize: 13 }}>Notifications</strong>
            {unread > 0 && (
              <button onClick={markAll} style={{ fontSize: 11, fontWeight: 700, color: '#6b5cf6', background: 'none', border: 'none', cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {loading && items.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--mu)', fontSize: 12 }}>Loading…</div>
            )}
            {!loading && items.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--mu)', fontSize: 12 }}>No notifications.</div>
            )}
            {items.map(n => (
              <button
                key={n.id}
                onClick={() => void review(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px',
                  border: 'none', borderBottom: '1px solid var(--bd)', background: n.isRead ? 'transparent' : 'var(--sf2)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: SEVERITY_COLOR[n.severity] || SEVERITY_COLOR.INFO, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                  {!n.isRead && <span style={{ fontSize: 9.5, fontWeight: 800, color: '#6b5cf6' }}>NEW</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--mu)', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                  {n.category} · {n.severity} · {rel(n.createdAt)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 4, lineHeight: 1.45 }}>{n.message}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}