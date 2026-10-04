'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UserActions({ userId, status }: { userId: string; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function setStatus(next: 'ACTIVE' | 'SUSPENDED') {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch(`/api/superadmin/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not update status.'); return; }
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resetAccess() {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch(`/api/superadmin/users/${userId}/reset-access`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not trigger reset.'); return; }
      setMessage(`Verification code sent to ${data.maskedDestination}.`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'ACTIVE' && (
          <button disabled={busy} onClick={() => setStatus('SUSPENDED')} style={{ border: 'none', background: 'var(--bad)', color: '#fff', borderRadius: 9, padding: '9px 14px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>Suspend</button>
        )}
        {status === 'SUSPENDED' && (
          <button disabled={busy} onClick={() => setStatus('ACTIVE')} style={{ border: 'none', background: 'var(--ok)', color: '#fff', borderRadius: 9, padding: '9px 14px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>Reactivate</button>
        )}
        {status !== 'SUSPENDED' && (
          <button disabled={busy} onClick={resetAccess} style={{ border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--tx)', borderRadius: 9, padding: '9px 14px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>Trigger Password Reset</button>
        )}
      </div>
      {message && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ok)', background: 'var(--oks)', padding: '9px 12px', borderRadius: 8 }}>{message}</div>}
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--bad)', background: 'var(--bads)', padding: '9px 12px', borderRadius: 8 }}>{error}</div>}
    </div>
  );
}
