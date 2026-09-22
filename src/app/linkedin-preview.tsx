'use client';

type Props = {
  caption?: string;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  mediaList?: Array<{ url: string; type: 'image' | 'video'; altText?: string }>;
  currentSlide?: number;
  onSlideChange?: (idx: number) => void;
  aspectRatio?: string;
  isCarousel?: boolean;
  profileName?: string;
  profileSubtitle?: string;
  avatarUrl?: string;
  logoUrl?: string;
  logoPosition?: string;
  logoScale?: number;
  logoOpacity?: number;
  burnedIds?: Record<string, boolean>;
};

function mediaAspectStyle(aspectRatio?: string): React.CSSProperties {
  if (aspectRatio === '9:16') return { aspectRatio: '9/16' };
  if (aspectRatio === '4:5') return { aspectRatio: '4/5' };
  if (aspectRatio === '16:9') return { aspectRatio: '16/9' };
  if (aspectRatio === '1.91:1') return { aspectRatio: '1.91/1' };
  return { aspectRatio: '1/1' };
}

export default function LinkedInPostPreview({
  caption = '',
  hashtags = [],
  mediaUrl,
  mediaType = 'image',
  mediaList,
  currentSlide = 0,
  onSlideChange,
  aspectRatio = '1:1',
  isCarousel = false,
  profileName = 'SocialPulse',
  profileSubtitle = 'Social Media Content Manager',
  avatarUrl,
  logoUrl,
  logoPosition = 'bottom-right',
  logoScale = 0.18,
  logoOpacity = 1,
  burnedIds = {},
}: Props) {
  const tagString = hashtags.map(t => '#' + String(t).replace(/^#+/, '')).join(' ');
  const cleanCaption = caption?.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim() || '';
  const fullCaption = [cleanCaption, tagString].filter(Boolean).join(' ');
  const needsMore = fullCaption.length > 220;
  const displayCaption = needsMore ? fullCaption.slice(0, 220) + '... more' : fullCaption || 'Your caption will appear here...';

  const slides = isCarousel && mediaList && mediaList.length > 1 ? mediaList : (mediaUrl ? [{ url: mediaUrl, type: mediaType, id: 'single' } as any] : []);
  const idx = Math.min(currentSlide, Math.max(0, slides.length - 1));
  const active = slides[idx];
  const hasMedia = slides.length > 0 && !!active?.url;

  const aspectStyle = mediaAspectStyle(aspectRatio);

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,0.06)' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 14px', alignItems: 'flex-start' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: avatarUrl ? `url(${avatarUrl}) center/cover` : 'linear-gradient(135deg,#7C3AED,#4F46E5)', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, overflow: 'hidden', flexShrink: 0 }}>
          {!avatarUrl && 'S'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{profileName}</span>
            <span style={{ fontSize: 14, color: '#64748b' }}>· You</span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 1 }}>{profileSubtitle}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>1w · <span style={{ fontSize: 13 }}>🌐</span></div>
        </div>
        <button aria-label="More" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'none', color: '#475569', fontSize: 18, cursor: 'pointer', fontWeight: 700 }}>⋯</button>
      </div>
      {/* Caption */}
      <div style={{ padding: '0 14px 10px', fontSize: 14, lineHeight: 1.5, color: '#0f172a', whiteSpace: 'pre-wrap' as const }}>
        {displayCaption}
      </div>
      {/* Media */}
      {hasMedia ? (
        <div style={{ backgroundColor: '#f8fafc', position: 'relative', overflow: 'hidden', width: '100%', ...aspectStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>
          {slides.length > 1 ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
              {active.type === 'video' ? (
                <video src={active.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline controls={false} />
              ) : (
                <img src={active.url} alt={active.altText || 'LinkedIn post media'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {logoUrl && !burnedIds[active.id] && (
                <img src={logoUrl} alt="logo" style={{
                  position: 'absolute', width: `${Math.round(logoScale*100)}%`, maxWidth: '28%', opacity: logoOpacity,
                  ...(logoPosition === 'top-left' ? { top: 8, left: 8 } : logoPosition === 'top-right' ? { top: 8, right: 8 } : logoPosition === 'bottom-left' ? { bottom: 8, left: 8 } : logoPosition === 'bottom-right' ? { bottom: 8, right: 8 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                  backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6,
                }} />
              )}
              <button aria-label="Previous" onClick={() => onSlideChange?.(idx === 0 ? slides.length - 1 : idx - 1)} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer' }}>‹</button>
              <button aria-label="Next" onClick={() => onSlideChange?.((idx + 1) % slides.length)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer' }}>›</button>
              <span style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(15,23,42,0.72)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 999 }}>{idx+1}/{slides.length}</span>
            </div>
          ) : (
            <>
              {active.type === 'video' ? (
                <video src={active.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
              ) : (
                <img src={active.url} alt={active.altText || 'LinkedIn post media'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {logoUrl && !burnedIds[active.id || 'single'] && (
                <img src={logoUrl} alt="logo" style={{
                  position: 'absolute', width: `${Math.round(logoScale*100)}%`, maxWidth: '28%', opacity: logoOpacity,
                  ...(logoPosition === 'top-left' ? { top: 8, left: 8 } : logoPosition === 'top-right' ? { top: 8, right: 8 } : logoPosition === 'bottom-left' ? { bottom: 8, left: 8 } : logoPosition === 'bottom-right' ? { bottom: 8, right: 8 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                  backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6,
                }} />
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ height: 220, backgroundColor: '#f8fafc', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12, flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 22 }}>🖼️</span> No media yet — add from Media
        </div>
      )}
      {isCarousel && slides.length > 1 && (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', padding: '8px 0', backgroundColor: '#fff', borderBottom: '1px solid #f1f5f9' }}>
          {slides.map((_, i) => (
            <span key={i} style={{ width: i===idx?14:6, height: 6, borderRadius: 999, backgroundColor: i===idx ? '#0A66C2' : '#e2e8f0', transition: 'all 0.18s' }} />
          ))}
        </div>
      )}
      {/* Reaction summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderBottom: '1px solid #f1f5f9' }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: '#0A66C2', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>👍</span>
        <span style={{ fontSize: 12, color: '#64748b' }}>2</span>
      </div>
      {/* Action row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
        {[
          { icon: '👍', label: 'Like' },
          { icon: '💬', label: 'Comment' },
          { icon: '↻', label: 'Repost' },
          { icon: '✈️', label: 'Send' },
        ].map(a => (
          <button key={a.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 0', border: 'none', background: 'none', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <span style={{ fontSize: 18 }}>{a.icon}</span>{a.label}
          </button>
        ))}
      </div>
      {/* Impressions footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: '#fff' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#0f172a', fontWeight: 600 }}><span style={{ fontSize: 16 }}>📊</span> 15 impressions</span>
        <a href="#" onClick={e => e.preventDefault()} style={{ fontSize: 13, color: '#0A66C2', fontWeight: 600, textDecoration: 'none' }}>View analytics</a>
      </div>
    </div>
  );
}
