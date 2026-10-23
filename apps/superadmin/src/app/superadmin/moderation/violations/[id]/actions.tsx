'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Violation incident actions. Mirrors the existing moderation-panel.tsx
 * pattern: nothing here is automatic, every action is a deliberate human
 * decision recorded with an actor (adminId is set server-side by the proxy
 * route from the Super Admin session, never trusted from the client).
 */
export default function IncidentActions({ incidentId, status }: { incidentId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function act(action: string) {
    setBusy(action);
    setError('');
    try {
      const res = await fetch(`/api/superadmin/moderation/violations/${incidentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
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

  return (
    <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '18px 20px' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800 }}>Review Actions</h3>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional review note"
        style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 9, border: '1px solid var(--bd)', fontSize: 12.5, marginBottom: 12, fontFamily: 'inherit' }}
      />
      {error && <div style={{ fontSize: 12, color: 'var(--er)', marginBottom: 10 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status !== 'UNDER_REVIEW' && (
          <button disabled={!!busy} onClick={() => void act('mark-under-review')} style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--tx)' }}>
            {busy === 'mark-under-review' ? 'Marking…' : 'Mark Under Review'}
          </button>
        )}
        <button disabled={!!busy} onClick={() => void act('resolve')} style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--oks)', background: 'var(--oks)', color: 'var(--ok)' }}>
          {busy === 'resolve' ? 'Resolving…' : 'Resolve'}
        </button>
        <button disabled={!!busy} onClick={() => void act('dismiss-false-positive')} style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--act)' }}>
          {busy === 'dismiss-false-positive' ? 'Dismissing…' : 'Dismiss as False Positive'}
        </button>
        {status === 'UNDER_REVIEW' && (
          <button
            disabled={!!busy}
            onClick={() => { if (window.confirm('This permanently restricts the media (no preview ever shown again) and flags the incident for escalation. This cannot be undone through this UI. Continue?')) void act('escalate-restricted'); }}
            style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--ers)', background: 'var(--ers)', color: 'var(--er)' }}
          >
            {busy === 'escalate-restricted' ? 'Escalating…' : 'Escalate — Restricted (CSAM-adjacent)'}
          </button>
        )}
      </div>
      {status === 'UNDER_REVIEW' && (
        <p style={{ fontSize: 11, color: 'var(--mu)', marginTop: 10, marginBottom: 0 }}>
          &quot;Escalate — Restricted&quot; does not run any automated detection and does not contact any external agency. It only
          marks this incident for your organization&apos;s own legal reporting process and suppresses the media preview going forward.
        </p>
      )}
    </div>
  );
}
