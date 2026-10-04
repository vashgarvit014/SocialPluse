'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TerminateButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function terminate() {
    setBusy(true);
    try {
      await fetch(`/api/superadmin/sessions/${sessionId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={terminate} disabled={busy} style={{ border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--bad)', borderRadius: 7, padding: '5px 10px', fontWeight: 700, fontSize: 12, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Terminating…' : 'Terminate'}
    </button>
  );
}
