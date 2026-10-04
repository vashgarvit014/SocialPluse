'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Every check here is already cheap (DB SELECT 1 + env-var presence — see
// system-health.ts) and reruns on every Server Component render, so "Run
// checks" is just a relabeled router.refresh(); there is no separate
// heavier check to trigger.
export default function RefreshButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  function run() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 500);
  }

  return (
    <button onClick={run} disabled={refreshing} style={{ border: 'none', background: 'var(--ac)', color: '#fff', borderRadius: 9, padding: '9px 14px', fontWeight: 700, cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.7 : 1 }}>
      {refreshing ? 'Checking…' : 'Run checks'}
    </button>
  );
}
