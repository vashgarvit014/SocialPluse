'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type DestinationType = 'community' | 'group' | 'chat';

export type Destination = {
  id: string;
  name: string;
  type: DestinationType;
  participantsCount: number;
  sendId: string;
};

const FILTERS: Array<{ key: DestinationType | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'community', label: 'Communities' },
  { key: 'group', label: 'Groups' },
  { key: 'chat', label: 'Chats' },
];

const TYPE_LABEL: Record<DestinationType, string> = {
  community: 'Community',
  group: 'Group',
  chat: 'Chat',
};

// Badge tint per destination type, matching the platform card's palette.
const TYPE_TINT: Record<DestinationType, { bg: string; fg: string; border: string }> = {
  community: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  group: { bg: '#DCFCE7', fg: '#166534', border: '#BBF7D0' },
  chat: { bg: '#DBEAFE', fg: '#1E40AF', border: '#BFDBFE' },
};

function Section({
  type, items, selected, onToggle, onSelectAll, limit, queryActive,
}: {
  type: DestinationType;
  items: Destination[];
  selected: Set<string>;
  onToggle: (d: Destination) => void;
  onSelectAll: (items: Destination[], select: boolean) => void;
  limit: number;
  queryActive: boolean;
}) {
  if (items.length === 0) return null;
  const shown = queryActive ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;
  const [expanded, setExpanded] = useState(false);
  const allSelected = items.every((d) => selected.has(d.id));

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#64748B' }}>
          {TYPE_LABEL[type]} <span style={{ color: '#94A3B8', fontWeight: 700 }}>({items.length})</span>
        </span>
        <button
          type="button"
          onClick={() => onSelectAll(items, !allSelected)}
          style={{ border: 'none', background: 'none', color: '#7C3AED', fontSize: 10.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' }}>
        {shown.map((d) => {
          const on = selected.has(d.id);
          const tint = TYPE_TINT[d.type];
          return (
            <label
              key={d.id}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderTop: '1px solid #F1F5F9', cursor: 'pointer', backgroundColor: on ? '#F5F3FF' : '#fff' }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(d)}
                style={{ width: 14, height: 14, accentColor: '#7C3AED', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.name}
              </span>
              {d.participantsCount > 0 && (
                <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, flexShrink: 0 }}>{d.participantsCount}</span>
              )}
              <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 999, backgroundColor: tint.bg, color: tint.fg, border: `1px solid ${tint.border}`, flexShrink: 0 }}>
                {d.type === 'community' ? 'COMM' : d.type === 'group' ? 'GRP' : 'CHAT'}
              </span>
            </label>
          );
        })}
        {hidden > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{ width: '100%', padding: '7px', border: 'none', borderTop: '1px solid #F1F5F9', backgroundColor: '#FAFAFC', color: '#7C3AED', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Show {hidden} more
          </button>
        )}
        {expanded && !queryActive && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{ width: '100%', padding: '7px', border: 'none', borderTop: '1px solid #F1F5F9', backgroundColor: '#FAFAFC', color: '#7C3AED', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

export default function WhatsAppDestinationPicker({
  destinations, loading, error, selected, onChange, onRefresh,
}: {
  destinations: Destination[];
  loading: boolean;
  error: string;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DestinationType | 'all'>('all');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const counts = useMemo(() => ({
    community: destinations.filter((d) => d.type === 'community').length,
    group: destinations.filter((d) => d.type === 'group').length,
    chat: destinations.filter((d) => d.type === 'chat').length,
  }), [destinations]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const byFilter = filter === 'all' ? destinations : destinations.filter((d) => d.type === filter);
    if (!q) return byFilter;
    return byFilter.filter((d) => d.name.toLowerCase().includes(q));
  }, [destinations, filter, q]);

  const grouped = useMemo(() => ({
    community: visible.filter((d) => d.type === 'community'),
    group: visible.filter((d) => d.type === 'group'),
    chat: visible.filter((d) => d.type === 'chat'),
  }), [visible]);

  function toggle(d: Destination) {
    const next = new Set(selected);
    if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
    onChange(next);
  }

  function selectAll(items: Destination[], select: boolean) {
    const next = new Set(selected);
    for (const d of items) { if (select) next.add(d.id); else next.delete(d.id); }
    onChange(next);
  }

  const selectedList = destinations.filter((d) => selected.has(d.id));

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      {/* summary + trigger */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ flex: 1, textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: `1px solid ${open ? '#7C3AED' : '#E2E8F0'}`, backgroundColor: '#fff', cursor: 'pointer', fontFamily: 'inherit', minHeight: 34 }}
        >
          {loading ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>Loading chats…</span>
          ) : selected.size === 0 ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>Select chats, groups or communities…</span>
          ) : (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {selectedList.slice(0, 3).map((d) => (
                <span key={d.id} style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, backgroundColor: '#F5F3FF', color: '#6D28D9', border: '1px solid #DDD6FE' }}>
                  {d.name.length > 22 ? `${d.name.slice(0, 22)}…` : d.name}
                </span>
              ))}
              {selected.size > 3 && (
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#7C3AED' }}>+{selected.size - 3} more</span>
              )}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh WhatsApp destinations"
          style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: '1px solid #E2E8F0', backgroundColor: '#fff', color: loading ? '#94A3B8' : '#1E293B', cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit' }}
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#DC2626', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '6px 8px', borderRadius: 8, marginTop: 6 }}>
          ⚠️ {error}
        </div>
      )}

      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 40, top: 'calc(100% + 6px)', left: 0, right: 0,
            backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
            boxShadow: '0 12px 32px rgba(15,23,42,0.16)', padding: 10, maxWidth: 460,
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats, groups, communities…"
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12, fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}
          />

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
            {FILTERS.map((f) => {
              const n = f.key === 'all' ? destinations.length : counts[f.key];
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  style={{
                    padding: '4px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
                    backgroundColor: active ? '#7C3AED' : '#F8FAFC',
                    color: active ? '#fff' : '#475569',
                    border: `1px solid ${active ? '#7C3AED' : '#E2E8F0'}`,
                  }}
                >
                  {f.label} {n}
                </button>
              );
            })}
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                style={{ marginLeft: 'auto', padding: '4px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', backgroundColor: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}
              >
                Clear ({selected.size})
              </button>
            )}
          </div>

          <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
            {visible.length === 0 ? (
              <div style={{ padding: '14px 4px', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
                {loading ? 'Loading…' : q ? `No matches for “${query}”` : 'No chats, groups or communities found.'}
              </div>
            ) : (
              <>
                <Section type="community" items={grouped.community} selected={selected} onToggle={toggle} onSelectAll={selectAll} limit={60} queryActive={!!q} />
                <Section type="group" items={grouped.group} selected={selected} onToggle={toggle} onSelectAll={selectAll} limit={60} queryActive={!!q} />
                <Section type="chat" items={grouped.chat} selected={selected} onToggle={toggle} onSelectAll={selectAll} limit={60} queryActive={!!q} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
