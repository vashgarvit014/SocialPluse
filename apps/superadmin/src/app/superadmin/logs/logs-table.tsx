'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SystemLogRow } from '@/lib/system-log';

const LEVEL_STYLE: Record<string, { bg: string; fg: string }> = {
  INFO: { bg: 'var(--neus)', fg: 'var(--neu)' },
  SUCCESS: { bg: 'var(--oks)', fg: 'var(--ok)' },
  WARN: { bg: 'var(--warns)', fg: 'var(--warn)' },
  ERROR: { bg: 'var(--bads)', fg: 'var(--bad)' },
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return iso;
  }
}

function fmtFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export default function LogsTable({ rows }: { rows: SystemLogRow[] }) {
  const router = useRouter();
  const [auto, setAuto] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find(r => r.id === openId) || null;

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(id);
  }, [auto, router]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setAuto(v => !v)}
          title="Auto refresh every 8 seconds"
          style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: '1px solid var(--bd)', background: auto ? 'var(--acs)' : 'var(--sf)', color: auto ? 'var(--act)' : 'var(--tx)', cursor: 'pointer' }}
        >
          Auto Refresh {auto ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          onClick={() => router.refresh()}
          style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--tx)', cursor: 'pointer' }}
        >
          ⟳ Refresh
        </button>
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1080 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 90px 110px 1.2fr 1.4fr 100px 1.6fr 90px', gap: 10, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
              <span>TIME</span><span>LEVEL</span><span>CATEGORY</span><span>EVENT</span><span>USER</span><span>PLATFORM</span><span>MESSAGE</span><span style={{ textAlign: 'right' }}>DETAILS</span>
            </div>
            {rows.map(r => {
              const st = LEVEL_STYLE[r.level] || LEVEL_STYLE.INFO;
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '80px 90px 110px 1.2fr 1.4fr 100px 1.6fr 90px', gap: 10, alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--bd)', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--mu)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtTime(r.createdAt)}</span>
                  <span><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{r.level}</span></span>
                  <span style={{ color: 'var(--mu)', whiteSpace: 'nowrap' }}>{r.category}</span>
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.event}</span>
                  <span style={{ color: 'var(--mu)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.userEmail || '—'}</span>
                  <span style={{ color: 'var(--mu)', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{r.platform || '—'}</span>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.message}</span>
                  <span style={{ textAlign: 'right' }}>
                    <button type="button" onClick={() => setOpenId(r.id)} style={{ border: '1px solid var(--bd)', background: 'var(--sf2)', borderRadius: 7, padding: '5px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: 'inherit' }}>View</button>
                  </span>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div style={{ padding: 36, textAlign: 'center', color: 'var(--mu)' }}>No logs match these filters.</div>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div onClick={() => setOpenId(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--ov)' }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(440px, 92vw)', background: 'var(--bg)', borderLeft: '1px solid var(--bd)', padding: '22px 20px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 800, fontSize: 15 }}>Log details</span>
              <button type="button" onClick={() => setOpenId(null)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--sf)', cursor: 'pointer', color: 'inherit' }}>✕</button>
            </div>
            {([
              ['Timestamp', fmtFull(open.createdAt)],
              ['Event', open.event],
              ['Level', open.level],
              ['Category', open.category],
              ['User', open.userEmail || '—'],
              ['User ID', open.userId || '—'],
              ['Platform', open.platform || '—'],
              ['Resource', open.resourceId || '—'],
              ['Request ID', open.requestId || '—'],
              ['Message', open.message],
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--bd)', fontSize: 13 }}>
                <span style={{ width: 110, flexShrink: 0, color: 'var(--mu)', fontWeight: 700 }}>{k}</span>
                <span style={{ wordBreak: 'break-word' }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>SAFE METADATA</div>
            <pre style={{ fontSize: 12, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 9, padding: '10px 12px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {open.metadata ? JSON.stringify(open.metadata, null, 2) : '—'}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
