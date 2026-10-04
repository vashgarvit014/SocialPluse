'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PublishActions({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'retry' | 'draft' | null>(null);

  async function run(kind: 'retry' | 'draft') {
    setBusy(kind);
    try {
      await fetch(`/api/superadmin/publishing/${postId}/${kind === 'retry' ? 'retry' : 'draft'}`, { method: 'POST' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
      <button onClick={() => run('retry')} disabled={!!busy} style={{ border: 'none', background: 'var(--ac)', color: '#fff', borderRadius: 7, padding: '5px 10px', fontWeight: 700, fontSize: 12, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy === 'retry' ? 'Retrying…' : 'Retry'}
      </button>
      <button onClick={() => run('draft')} disabled={!!busy} style={{ border: '1px solid var(--bd)', background: 'var(--sf)', borderRadius: 7, padding: '5px 9px', fontWeight: 700, fontSize: 12, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
        {busy === 'draft' ? 'Moving…' : 'Move to Draft'}
      </button>
    </span>
  );
}
