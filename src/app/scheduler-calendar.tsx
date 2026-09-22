'use client';

import { useState } from 'react';
import type { PostRecord } from '@/lib/posts';

export type SchedulerMode = 'drafts' | 'scheduled' | 'published';
export type CalendarView = 'week' | 'month' | 'list';

type SchedulerCalendarProps = {
  title: string;
  headerMeta: string;
  posts: PostRecord[];
  dateOf: (post: PostRecord) => string;
  toDateKey: (iso: string) => string;
  formatTime: (iso: string) => string;
  mode: SchedulerMode;
  emptyText: string;
  days: Date[];
  todayKey: string;
  dayKeyOf: (day: Date) => string;
  weekLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  monthAnchor: Date;
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onPostClick: (post: PostRecord) => void;
  onReschedule?: (post: PostRecord) => void;
  onCancel?: (id: string) => void;
  onEdit?: (post: PostRecord) => void;
  onSchedule?: (post: PostRecord) => void;
  onDelete?: (post: PostRecord) => void;
  onDuplicate?: (post: PostRecord) => void;
  platformColors: Record<string, string>;
  PlatformIcon: ({ platform, size }: { platform: string; size?: number }) => React.JSX.Element;
  getMedia: (post: PostRecord) => { url: string; isVideo: boolean };
};

function startOfWeek(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() - c.getDay());
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function statusBadge(mode: SchedulerMode, post: PostRecord): { label: string; bg: string; color: string; border: string } {
  if (mode === 'drafts') {
    const cancelled = !!(post as unknown as { previousScheduledAt?: string }).previousScheduledAt || post.status === 'cancelled';
    return cancelled
      ? { label: 'SCHEDULE CANCELLED', bg: '#fffbeb', color: '#b45309', border: '#fde68a' }
      : { label: 'DRAFT', bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
  }
  if (mode === 'scheduled') {
    if (post.status === 'publishing') {
      return { label: 'PUBLISHING', bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
    }
    return post.status === 'failed'
      ? { label: 'FAILED', bg: '#fee2e2', color: '#dc2626', border: '#fecaca' }
      : { label: 'SCHEDULED', bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe' };
  }
  return { label: 'PUBLISHED', bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' };
}

function PostCard(props: {
  post: PostRecord;
  mode: SchedulerMode;
  formatTime: (iso: string) => string;
  dateOf: (post: PostRecord) => string;
  onPostClick: (post: PostRecord) => void;
  onReschedule?: (post: PostRecord) => void;
  onCancel?: (id: string) => void;
  platformColors: Record<string, string>;
  PlatformIcon: ({ platform, size }: { platform: string; size?: number }) => React.JSX.Element;
  getMedia: (post: PostRecord) => { url: string; isVideo: boolean };
}) {
  const { post, mode } = props;
  const m = props.getMedia(post);
  const badge = statusBadge(mode, post);
  return (
    <div onClick={(e) => { e.stopPropagation(); props.onPostClick(post); }} style={{ border: `1px solid ${badge.border}`, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fafbfc', cursor: 'pointer' }}>
      {m.url ? (m.isVideo ? <video src={m.url} style={{ width: '100%', height: 54, objectFit: 'cover', display: 'block', backgroundColor: '#000' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: 54, objectFit: 'cover', display: 'block' }} />) : null}
      <div style={{ padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          {post.platforms.map(pl => (<span key={pl} style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: props.platformColors[pl] || '#94a3b8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><props.PlatformIcon platform={pl} size={7} /></span>))}
          <span style={{ fontSize: 10, color: '#94a3b8' }}>{props.formatTime(props.dateOf(post))}</span>
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, backgroundColor: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, padding: '1px 5px', borderRadius: 4 }}>{badge.label}</span>
          {post.trialReel === true && post.platforms.includes('instagram') && (
            <span style={{ fontSize: 9, fontWeight: 800, backgroundColor: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', padding: '1px 5px', borderRadius: 4 }}>TRIAL REEL</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{post.content.split('\n')[0].slice(0, 60) || 'Untitled draft'}</div>
        {mode === 'scheduled' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={(e) => { e.stopPropagation(); props.onReschedule?.(post); }} style={{ flex: 1, padding: '4px 6px', borderRadius: 6, fontSize: 10, fontWeight: 600, border: 'none', backgroundColor: '#eef2ff', color: '#4338ca', cursor: 'pointer' }}>Reschedule</button>
            <button onClick={(e) => { e.stopPropagation(); props.onCancel?.(post.id); }} style={{ flex: 1, padding: '4px 6px', borderRadius: 6, fontSize: 10, fontWeight: 600, border: 'none', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

// Edited-after-creation (edits, reschedules and cancel-touches all stamp
// updatedAt server-side, so updatedAt > createdAt reliably means "touched").
function isEdited(post: PostRecord): boolean {
  return !!post.updatedAt && !!post.createdAt && post.updatedAt > post.createdAt;
}

function DayTimelineDrawer(props: {
  dayKey: string;
  dayPosts: PostRecord[];
  mode: SchedulerMode;
  dateOf: (post: PostRecord) => string;
  formatTime: (iso: string) => string;
  onClose: () => void;
  onPostClick: (post: PostRecord) => void;
  onReschedule?: (post: PostRecord) => void;
  onCancel?: (id: string) => void;
  onEdit?: (post: PostRecord) => void;
  onSchedule?: (post: PostRecord) => void;
  onDelete?: (post: PostRecord) => void;
  onDuplicate?: (post: PostRecord) => void;
  platformColors: Record<string, string>;
  PlatformIcon: ({ platform, size }: { platform: string; size?: number }) => React.JSX.Element;
  getMedia: (post: PostRecord) => { url: string; isVideo: boolean };
}) {
  const { dayPosts, mode } = props;
  const [menuPostId, setMenuPostId] = useState<string | null>(null);
  const dayLabel = (() => {
    const d = new Date(`${props.dayKey}T12:00:00`);
    return Number.isNaN(d.getTime()) ? props.dayKey : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })();
  const noun = mode === 'drafts' ? 'draft' : mode === 'published' ? 'published post' : 'scheduled post';
  // One unified list, latest edited first: updatedAt DESC, then the day's
  // own timestamp DESC, then createdAt DESC. No post appears twice.
  const ordered = [...dayPosts].sort((a, b) =>
    (b.updatedAt || '').localeCompare(a.updatedAt || '') ||
    props.dateOf(b).localeCompare(props.dateOf(a)) ||
    (b.createdAt || '').localeCompare(a.createdAt || ''));

  const actionsFor = (post: PostRecord): Array<{ label: string; danger?: boolean; run: () => void }> => {
    const acts: Array<{ label: string; danger?: boolean; run: () => void }> = [{ label: 'Preview', run: () => props.onPostClick(post) }];
    if (post.status === 'pending') {
      if (props.onEdit) acts.push({ label: 'Edit', run: () => props.onEdit?.(post) });
      if (props.onReschedule) acts.push({ label: 'Reschedule', run: () => props.onReschedule?.(post) });
      if (props.onCancel) acts.push({ label: 'Cancel → Draft', danger: true, run: () => props.onCancel?.(post.id) });
    } else if (post.status === 'failed') {
      if (props.onSchedule) acts.push({ label: 'Retry', run: () => props.onSchedule?.(post) });
      if (props.onEdit) acts.push({ label: 'Edit', run: () => props.onEdit?.(post) });
      if (props.onCancel) acts.push({ label: 'Move to Drafts', run: () => props.onCancel?.(post.id) });
    } else if (post.status === 'draft' || post.status === 'cancelled') {
      if (props.onEdit) acts.push({ label: 'Edit', run: () => props.onEdit?.(post) });
      if (props.onSchedule) acts.push({ label: (post as unknown as { previousScheduledAt?: string }).previousScheduledAt ? 'Schedule Again' : 'Schedule', run: () => props.onSchedule?.(post) });
      if (props.onDelete) acts.push({ label: 'Delete', danger: true, run: () => props.onDelete?.(post) });
    } else if (post.status === 'published') {
      if (props.onDuplicate) acts.push({ label: 'Duplicate as Draft', run: () => props.onDuplicate?.(post) });
    }
    return acts;
  };

  const item = (post: PostRecord) => {
    const m = props.getMedia(post);
    const badge = statusBadge(mode, post);
    const edited = isEdited(post);
    const menuOpen = menuPostId === post.id;
    return (
      <div key={post.id} style={{ display: 'flex', gap: 10, padding: 10, borderRadius: 12, border: '1px solid #eef2f7', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
        {m.url ? (
          <div style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', backgroundColor: '#0f172a', flexShrink: 0 }}>
            {m.isVideo ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          </div>
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>📝</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed' }}>{props.formatTime(props.dateOf(post))}</span>
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {post.platforms.map(pl => (<span key={pl} style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: props.platformColors[pl] || '#94a3b8', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><props.PlatformIcon platform={pl} size={8} /></span>))}
            </span>
            <span style={{ fontSize: 9, fontWeight: 800, backgroundColor: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, padding: '1px 6px', borderRadius: 999 }}>{badge.label}</span>
            {post.trialReel === true && post.platforms.includes('instagram') && (
              <span style={{ fontSize: 9, fontWeight: 800, backgroundColor: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: 999 }}>TRIAL REEL</span>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' as const }}>{post.content.split('\n')[0].slice(0, 80) || 'Untitled'}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' }}>{edited ? `Edited ${props.formatTime(post.updatedAt || '')} · ${timeAgo(post.updatedAt)}` : post.platforms.join(' + ') || (mode === 'drafts' ? 'Draft' : 'No platform')}</div>
        </div>
        <div style={{ position: 'relative' as const, flexShrink: 0 }}>
          <button aria-label="Post actions" onClick={() => setMenuPostId(menuOpen ? null : post.id)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#475569', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>⋮</button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuPostId(null)} style={{ position: 'fixed' as const, inset: 0, zIndex: 701 }} />
              <div style={{ position: 'absolute' as const, right: 0, top: 32, width: 150, backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.18)', zIndex: 702, overflow: 'hidden', padding: 4 }}>
                {actionsFor(post).map(a => (
                  <button key={a.label} onClick={() => { setMenuPostId(null); a.run(); }} style={{ display: 'block', width: '100%', textAlign: 'left' as const, fontSize: 12, fontWeight: 600, color: a.danger ? '#dc2626' : '#0f172a', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer' }}>{a.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div role="dialog" aria-label={`Timeline for ${dayLabel}`} style={{ position: 'fixed' as const, top: 0, right: 0, height: '100vh', width: 'min(480px, 100vw)', backgroundColor: '#f8fafc', borderLeft: '1px solid #e2e8f0', boxShadow: '-16px 0 48px rgba(15,23,42,0.16)', zIndex: 600, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 18px 12px', backgroundColor: '#fff', borderBottom: '1px solid #eef2f7' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{dayLabel} · {dayPosts.length} {noun}{dayPosts.length === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Sorted by latest edit first</div>
          </div>
          <button onClick={props.onClose} aria-label="Close timeline" style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', fontSize: 15, cursor: 'pointer' }}>✕</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' as const, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dayPosts.length === 0 && <div style={{ padding: 28, textAlign: 'center' as const, color: '#94a3b8', fontSize: 12 }}>No posts for this date.</div>}
        {ordered.map(item)}
      </div>
      <div style={{ padding: 14, backgroundColor: '#fff', borderTop: '1px solid #eef2f7', display: 'flex', gap: 10 }}>
        <button onClick={props.onClose} style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  );
}

export default function SchedulerCalendar(props: SchedulerCalendarProps) {
  const { posts, dateOf, toDateKey, mode, view } = props;
  const byDay: Record<string, PostRecord[]> = {};
  posts.forEach(p => {
    const iso = dateOf(p);
    if (!iso) return;
    const key = toDateKey(iso);
    if (!key || key === 'Invalid Date') return;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(p);
  });
  const countColor = mode === 'published' ? '#10b981' : '#6366f1';
  const countNoun = mode === 'drafts' ? 'draft' : 'post';

  // Month grid: 6 weeks x 7 days starting Sunday of the week containing the 1st.
  const monthStart = new Date(props.monthAnchor.getFullYear(), props.monthAnchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const monthCells: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const inMonth = (d: Date) => d.getMonth() === props.monthAnchor.getMonth();

  const viewBtn = (v: CalendarView, label: string) => {
    const active = view === v;
    return (
      <button key={v} onClick={() => props.onViewChange(v)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: active ? 700 : 500, border: 'none', backgroundColor: active ? '#0f172a' : 'transparent', color: active ? '#fff' : '#64748b', cursor: 'pointer' }}>{label}</button>
    );
  };

  const dayHeader = (day: Date, idx: number, count: number) => {
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}-${idx}`;
    const isToday = props.dayKeyOf(day) === props.todayKey;
    return (
      <div key={key} style={{ padding: '10px 6px', textAlign: 'center' as const, borderRight: idx < 6 ? '1px solid #f8fafc' : 'none' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
        <div style={{ margin: '4px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', fontSize: 13, fontWeight: 700, backgroundColor: isToday ? '#0f172a' : 'transparent', color: isToday ? '#fff' : '#334155' }}>{day.getDate()}</div>
        {count > 0 && <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: countColor }}>{count} {countNoun}{count !== 1 ? 's' : ''}</div>}
      </div>
    );
  };

  const cardProps = {
    mode, formatTime: props.formatTime, dateOf: props.dateOf,
    onPostClick: props.onPostClick, onReschedule: props.onReschedule, onCancel: props.onCancel,
    onEdit: props.onEdit, onDelete: props.onDelete,
    platformColors: props.platformColors, PlatformIcon: props.PlatformIcon, getMedia: props.getMedia,
  };
  // Day-timeline drawer: null = closed, otherwise the YYYY-MM-DD key whose
  // posts are shown. Stays inside Scheduler; counts refresh live from posts.
  const [timelineDay, setTimelineDay] = useState<string | null>(null);

  const sortedDated = [...posts]
    .map(p => ({ p, iso: dateOf(p) }))
    .filter(x => x.iso && !Number.isNaN(Date.parse(x.iso)))
    .sort((a, b) => a.iso.localeCompare(b.iso));

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px 0', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{props.title}</div>
      <div style={{ padding: '10px 20px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
        <button onClick={view === 'month' ? props.onPrevMonth : props.onPrevWeek} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', backgroundColor: '#f1f5f9', color: '#475569', cursor: 'pointer', fontSize: 13 }}>‹</button>
        <button onClick={props.onToday} style={{ padding: '6px 14px', borderRadius: '999px', border: 'none', backgroundColor: '#f1f5f9', color: '#334155', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Today</button>
        <button onClick={view === 'month' ? props.onNextMonth : props.onNextWeek} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', backgroundColor: '#f1f5f9', color: '#475569', cursor: 'pointer', fontSize: 13 }}>›</button>
        <span style={{ flex: 1, textAlign: 'center' as const, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{view === 'month' ? props.monthLabel : props.weekLabel}</span>
        <span style={{ display: 'inline-flex', backgroundColor: '#f1f5f9', borderRadius: 999, padding: 3, gap: 2 }}>
          {viewBtn('week', 'Week')}{viewBtn('month', 'Month')}{viewBtn('list', 'List')}
        </span>
        <span style={{ fontSize: 11, color: '#64748b' }}>{props.headerMeta}</span>
      </div>

      {view === 'list' ? (
        <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 560, overflowY: 'auto' as const }}>
          {sortedDated.length === 0 && <div style={{ padding: 32, textAlign: 'center' as const, color: '#94a3b8', fontSize: 12 }}>{props.emptyText}</div>}
          {sortedDated.map(({ p, iso }) => (
            <div key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flexShrink: 0, width: 64, textAlign: 'center' as const, paddingTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>{new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{props.formatTime(iso)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PostCard post={p} {...cardProps} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #f1f5f9' }}>
            {(view === 'month' ? monthCells.slice(0, 7).map((d, i) => ({ d, i })) : props.days.map((d, i) => ({ d, i }))).map(({ d, i }) => (
              <div key={`h-${i}`} style={{ padding: '10px 6px', textAlign: 'center' as const, borderRight: i < 6 ? '1px solid #f8fafc' : 'none' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: 180 }}>
            {(view === 'month' ? monthCells : props.days).map((day, idx) => {
              const key = props.dayKeyOf(day);
              const dayPosts = byDay[key] || [];
              const dimmed = view === 'month' && day.getMonth() !== props.monthAnchor.getMonth();
              const isToday = key === props.todayKey;
              // Clean cells: dates only + highlight + count. Never render post
              // cards inside grid cells. Yellow = has content, purple = today
              // (today wins), red pill = record count. Clicking the date or
              // the pill opens the day drawer.
              const hasPosts = dayPosts.length > 0;
              const isTodayCell = isToday && !dimmed;
              return (
                <div key={`${key}-${idx}`} style={{ padding: '10px 6px', borderRight: idx % 7 < 6 ? '1px solid #f8fafc' : 'none', borderBottom: '1px solid #f8fafc', backgroundColor: isTodayCell ? '#f5f3ff' : hasPosts ? '#fefce8' : dimmed ? '#fafbfc' : '#fff', boxShadow: hasPosts && !isTodayCell ? 'inset 0 0 0 1px #fde68a' : undefined, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minHeight: view === 'month' ? 96 : 120, opacity: dimmed ? 0.55 : 1 }}>
                  <button onClick={() => { if (hasPosts) setTimelineDay(key); }} title={hasPosts ? `View ${dayPosts.length} ${countNoun}${dayPosts.length === 1 ? '' : 's'} timeline` : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', border: 'none', fontSize: 13, fontWeight: 700, backgroundColor: isTodayCell ? '#7c3aed' : 'transparent', color: isTodayCell ? '#fff' : '#334155', cursor: hasPosts ? 'pointer' : 'default' }}>{day.getDate()}</button>
                  {hasPosts && (
                    <button onClick={() => setTimelineDay(key)} style={{ border: 'none', backgroundColor: '#dc2626', color: '#fff', borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>{dayPosts.length} {countNoun}{dayPosts.length === 1 ? '' : 's'}</button>
                  )}
                </div>
              );
            })}
          </div>
          {posts.length === 0 && <div style={{ padding: 32, textAlign: 'center' as const, color: '#94a3b8', fontSize: 12 }}>{props.emptyText}</div>}
        </>
      )}
      {timelineDay && (
        <DayTimelineDrawer
          dayKey={timelineDay}
          dayPosts={[...(byDay[timelineDay] || [])]}
          mode={mode}
          dateOf={props.dateOf}
          formatTime={props.formatTime}
          onClose={() => setTimelineDay(null)}
          onPostClick={(post) => { setTimelineDay(null); props.onPostClick(post); }}
          onReschedule={props.onReschedule ? (post) => { setTimelineDay(null); props.onReschedule?.(post); } : undefined}
          onCancel={props.onCancel}
          onEdit={props.onEdit ? (post) => { setTimelineDay(null); props.onEdit?.(post); } : undefined}
          onSchedule={props.onSchedule ? (post) => { setTimelineDay(null); props.onSchedule?.(post); } : undefined}
          onDelete={props.onDelete}
          onDuplicate={props.onDuplicate}
          platformColors={props.platformColors}
          PlatformIcon={props.PlatformIcon}
          getMedia={props.getMedia}
        />
      )}
    </div>
  );
}
