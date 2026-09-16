'use client';
import { useState } from 'react';
import { postMedia, type PostRecord } from '@/lib/posts';

const platformColors: Record<string, string> = {
  linkedin: '#0A66C2', instagram: '#E1306C', facebook: '#1877F2', twitter: '#000000', whatsapp: '#25D366',
};
const statusMeta: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: '#FFFBEB', color: '#B45309', label: 'Scheduled' },
  publishing: { bg: '#FFFBEB', color: '#B45309', label: 'Publishing' },
  published: { bg: '#ECFDF5', color: '#059669', label: 'Published' },
  failed: { bg: '#FEF2F2', color: '#DC2626', label: 'Failed' },
  draft: { bg: '#F1F5F9', color: '#64748B', label: 'Draft' },
  cancelled: { bg: '#F1F5F9', color: '#64748B', label: 'Draft' },
};

const action: React.CSSProperties = { padding: '8px 13px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#5B21B6', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const fieldLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };
const timeBadge: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#334155', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 999, padding: '4px 10px' };

// Card action button with a hover lift. `primary` highlights the single most
// useful next step (Schedule Again on a draft, Reschedule on a pending post);
// `danger` marks destructive actions (Cancel, Delete) per the app's action-hierarchy rule.
function Btn({ children, icon, onClick, variant = 'default' }: { children: React.ReactNode; icon?: string; onClick: () => void; variant?: 'default' | 'danger' | 'primary' }) {
  const [hover, setHover] = useState(false);
  const base: React.CSSProperties = {
    padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', transform: hover ? 'translateY(-1px)' : 'none',
  };
  const variants: Record<string, React.CSSProperties> = {
    default: { border: '1px solid #E2E8F0', background: hover ? '#F1F5F9' : '#F8FAFC', color: '#5B21B6', boxShadow: hover ? '0 3px 8px rgba(15,23,42,0.08)' : 'none' },
    danger: { border: '1px solid #FECACA', background: hover ? '#FEE2E2' : '#FEF2F2', color: '#DC2626', boxShadow: hover ? '0 3px 8px rgba(220,38,38,0.12)' : 'none' },
    primary: { border: 'none', color: '#fff', background: hover ? 'linear-gradient(135deg, #7C3AED, #6D28D9)' : 'linear-gradient(135deg, #8B5CF6, #7C3AED)', boxShadow: hover ? '0 5px 14px rgba(124,58,237,0.35)' : '0 2px 8px rgba(124,58,237,0.25)' },
  };
  return <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ ...base, ...variants[variant] }}>{icon && <span aria-hidden>{icon}</span>}{children}</button>;
}

export default function PostPreview({ post, edit, reschedule, cancel, remove }: { post: PostRecord; edit: (schedule?: boolean) => void; reschedule?: () => void; cancel?: () => void; remove?: () => void }) {
  const [slide, setSlide] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const media = postMedia(post); const item = media[Math.min(slide, Math.max(0, media.length - 1))];
  const draft = ['draft', 'cancelled'].includes(post.status);
  const publishing = post.status === 'publishing';
  const meta = statusMeta[post.status] || statusMeta.draft;
  const sourceLabel = draft ? (post.source || (post.status === 'cancelled' ? 'Schedule Cancelled' : 'Manual Draft')) : meta.label;
  // A scheduled post's own time while it's pending; the time it *was*
  // scheduled for once it lands in Drafts (cancelled or otherwise).
  const displayTime = post.status === 'pending' ? post.scheduledAt : post.previousScheduledAt;

  return <article style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 20, minWidth: 0, boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.35 }}>{post.content?.split('\n')[0]?.slice(0, 100) || 'Untitled draft'}</h3>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '4px 9px', borderRadius: 999, backgroundColor: meta.bg, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', flexShrink: 0 }}>{sourceLabel}</span>
      </div>
      {displayTime && <div style={{ ...timeBadge, marginTop: 8 }}>🕐 {new Date(displayTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>}
    </div>

    {item && (item.type === 'video'
      ? <video src={item.url} controls style={{ width: '100%', maxHeight: 320, borderRadius: 10, border: '1px solid #E2E8F0', backgroundColor: '#000' }} />
      : <img src={item.url} alt={item.altText || ''} style={{ width: '100%', maxHeight: expanded ? 640 : 280, objectFit: 'contain', backgroundColor: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }} />
    )}
    {media.length > 1 && (
      <div aria-label="Carousel slides" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {media.map((m, i) => (
          <button
            key={m.id}
            aria-pressed={slide === i}
            onClick={() => setSlide(i)}
            style={{ ...action, padding: '5px 10px', ...(slide === i ? { background: '#EEF2FF', borderColor: '#C7D2FE', color: '#4338CA' } : {}) }}
          >Slide {i + 1}</button>
        ))}
      </div>
    )}

    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {post.platforms.length
        ? post.platforms.map(p => <span key={p} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, backgroundColor: `${platformColors[p] || '#94A3B8'}1A`, color: platformColors[p] || '#475569', textTransform: 'capitalize' }}>{p}</span>)
        : <span style={{ fontSize: 12, color: '#94A3B8' }}>No platform selected</span>}
    </div>

    <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{expanded ? post.content : post.content?.slice(0, 320)}</p>
    {expanded && post.platformContent && Object.entries(post.platformContent).map(([platform, value]) => (
      <details key={platform} style={{ fontSize: 12, color: '#334155' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, textTransform: 'capitalize' }}>{platform} caption</summary>
        <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{value.caption}</p>
        <p style={{ color: '#6366F1', margin: '4px 0 0' }}>{value.hashtags.join(' ')}</p>
      </details>
    ))}

    <div>
      <div style={fieldLabel}>Accessibility</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', fontSize: 12, color: '#475569' }}>
        {media.filter(m => m.type === 'image').map((m, i) => (
          <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Slide {i + 1} {m.altText?.trim() ? <span style={{ color: '#059669', fontWeight: 600 }}>✓ ALT added</span> : <span style={{ color: '#D97706', fontWeight: 600 }}>⚠ Missing ALT</span>}
          </span>
        ))}
      </div>
      {item?.altText && expanded && <p style={{ fontSize: 12, color: '#64748B', margin: '6px 0 0' }}>{item.altText}</p>}
    </div>

    <small style={{ color: '#94A3B8', fontSize: 11 }}>Updated {new Date(post.updatedAt || post.createdAt).toLocaleString()}{post.cancelledAt ? ` · Cancelled ${new Date(post.cancelledAt).toLocaleString()}` : ''}</small>

    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', borderTop: '1px solid #F1F5F9', paddingTop: 14 }}>
      <Btn icon={expanded ? '✕' : '👁️'} onClick={() => setExpanded(!expanded)}>{expanded ? 'Close Preview' : 'Preview'}</Btn>
      {['draft', 'cancelled', 'pending', 'scheduled'].includes(post.status) && <Btn icon="✏️" onClick={() => edit()}>Edit</Btn>}
      {draft && <Btn icon="🚀" variant="primary" onClick={() => edit(true)}>Schedule Again</Btn>}
      {reschedule && !publishing && <Btn icon="🔄" variant="primary" onClick={reschedule}>Reschedule</Btn>}
      {cancel && !publishing && <Btn icon="✕" variant="danger" onClick={cancel}>Cancel Schedule</Btn>}
      {publishing && (reschedule || cancel) && <span style={{ fontSize: 12, fontWeight: 600, color: '#B45309' }}>Publishing — can no longer be cancelled</span>}
      {remove && <Btn icon="🗑️" variant="danger" onClick={remove}>Delete</Btn>}
    </div>
  </article>;
}
