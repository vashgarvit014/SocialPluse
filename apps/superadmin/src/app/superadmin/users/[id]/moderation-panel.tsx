'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Summary {
  violationCount: number;
  flagged: boolean;
  flagReason: string | null;
  flaggedAt: string | null;
  firstViolationAt: string | null;
  lastViolationAt: string | null;
  latestDecision: string | null;
  latestMethod: string | null;
  severity: string;
}

/**
 * Moderation review panel.
 *
 * "Clear flag" is always available and is the intended response to a false
 * positive. Nothing here is irreversible, and no action is automatic: an
 * account is never banned by the system, only by a human decision recorded
 * with an actor.
 */
export default function ModerationPanel({ userId, summary }: { userId: string; summary: Summary | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (!summary) return null;

  async function act(action: string) {
    setBusy(action);
    setError('');
    try {
      const res = await fetch(`/api/superadmin/moderation/users/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Action failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy('');
    }
  }

  const rows: Array<[string, string]> = [
    ['Violation Count', String(summary.violationCount)],
    ['Severity', summary.severity],
    ['Flag Status', summary.flagged ? 'FLAGGED' : 'CLEAR'],
    ['Flag Reason', summary.flagReason || '—'],
    ['Flagged At', summary.flaggedAt ? new Date(summary.flaggedAt).toLocaleString() : '—'],
    ['First Violation', summary.firstViolationAt ? new Date(summary.firstViolationAt).toLocaleString() : '—'],
    ['Latest Violation', summary.lastViolationAt ? new Date(summary.lastViolationAt).toLocaleString() : '—'],
    ['Latest Decision', summary.latestDecision ? summary.latestDecision.replace(/_/g, ' ') : '—'],
    ['Detected By', summary.latestMethod || '—'],
  ];

  return (
    <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Moderation Summary</h2>
        {summary.flagged && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'var(--ers)', color: 'var(--er)' }}>
            FLAGGED
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2px 20px', marginBottom: 16 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--bd)', fontSize: 12.5 }}>
            <span style={{ color: 'var(--mu)' }}>{k}</span>
            <span style={{ fontWeight: 700, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--er)', marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {summary.flagged && (
          <button
            onClick={() => void act('clear-flag')}
            disabled={!!busy}
            style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--act)' }}
          >
            {busy === 'clear-flag' ? 'Clearing…' : 'Clear flag'}
          </button>
        )}
        {summary.violationCount > 0 && (
          <button
            onClick={() => void act('reset-counter')}
            disabled={!!busy}
            style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--mu)' }}
          >
            {busy === 'reset-counter' ? 'Resetting…' : 'Reset counter'}
          </button>
        )}
        <button
          onClick={() => void act('suspend')}
          disabled={!!busy}
          style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--ers)', background: 'var(--ers)', color: 'var(--er)' }}
        >
          {busy === 'suspend' ? 'Suspending…' : 'Suspend account'}
        </button>
        <button
          onClick={() => void act('reactivate')}
          disabled={!!busy}
          style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--oks)', background: 'var(--oks)', color: 'var(--ok)' }}
        >
          {busy === 'reactivate' ? 'Reactivating…' : 'Reactivate account'}
        </button>
      </div>
    </div>
  );
}