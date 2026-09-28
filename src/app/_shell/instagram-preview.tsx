'use client';

type InstagramPreviewProps = {
  username?: string;
  avatarUrl?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  mediaList?: Array<{ url: string; type: 'image' | 'video'; altText?: string }>;
  currentSlide?: number;
  onSlideChange?: (idx: number) => void;
  caption?: string;
  hashtags?: string[];
  aspectRatio?: string;
  isCarousel?: boolean;
};

function getMediaAspect(aspectRatio?: string): React.CSSProperties {
  if (aspectRatio === '9:16') return { aspectRatio: '9/16' };
  if (aspectRatio === '4:5') return { aspectRatio: '4/5' };
  if (aspectRatio === '16:9' || aspectRatio === '1.91:1') return { aspectRatio: '1.91/1' };
  return { aspectRatio: '1/1' };
}

// Realistic dark-theme Instagram feed post preview (preview-only, no publishing logic).
export default function InstagramPhonePreview({
  username = 'dotstark_technologies',
  avatarUrl,
  mediaUrl,
  mediaType = 'image',
  mediaList,
  currentSlide = 0,
  onSlideChange,
  caption = '',
  hashtags = [],
  aspectRatio = '1:1',
  isCarousel = false,
}: InstagramPreviewProps) {
  const displayUsername = username?.replace(/^@/, '') || 'dotstark_technologies';
  const tagString = hashtags.map(t => '#' + String(t).replace(/^#+/, '')).join(' ');
  const clean = caption?.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim() || '';
  const full = [clean, tagString].filter(Boolean).join(' ');
  const shown = full.length > 200 ? full.slice(0, 200) + '... more' : full || 'Your caption will appear here...';

  const slides = isCarousel && mediaList && mediaList.length > 1 ? mediaList : (mediaUrl ? [{ url: mediaUrl, type: mediaType, altText: clean.slice(0, 80) }] : []);
  const idx = Math.min(currentSlide, Math.max(0, slides.length - 1));
  const active = slides[idx] as any;
  const hasMedia = !!active?.url;
  const aspectStyle = getMediaAspect(aspectRatio);

  return (
    <div style={{ width: '100%', maxWidth: 560, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', border: '1px solid #262626', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarUrl ? `url(${avatarUrl}) center/cover` : 'linear-gradient(135deg,#6b7280,#9ca3af)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, overflow: 'hidden', flexShrink: 0 }}>👤</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#f5f5f5' }}>{displayUsername}</span>
          <span style={{ fontSize: 13, color: '#a8a8a8' }}>• 1w</span>
        </div>
        <button aria-label="More options" style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'none', color: '#e4e6eb', fontSize: 18, cursor: 'pointer', fontWeight: 700, letterSpacing: 2 }}>•••</button>
      </div>
      {/* Media */}
      <div style={{ backgroundColor: '#000', position: 'relative', overflow: 'hidden', width: '100%', ...aspectStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {hasMedia ? (
          active.type === 'video' ? (
            <video src={active.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          ) : (
            <img src={active.url} alt={active.altText || 'Instagram preview'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )
        ) : (
          <div style={{ color: '#737373', fontSize: 13, textAlign: 'center', padding: 40 }}>No media yet — add from Media</div>
        )}
        {isCarousel && slides.length > 1 && (
          <>
            <button aria-label="Previous slide" onClick={() => onSlideChange?.(idx === 0 ? slides.length - 1 : idx - 1)} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>‹</button>
            <button aria-label="Next slide" onClick={() => onSlideChange?.((idx + 1) % slides.length)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>›</button>
            <span style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 999 }}>{idx+1}/{slides.length}</span>
            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', gap: 4, justifyContent: 'center' }}>
              {slides.map((_, i) => (
                <span key={i} style={{ width: i===idx?14:5, height: 5, borderRadius: 999, backgroundColor: i===idx ? '#fff' : 'rgba(255,255,255,0.5)', transition: 'all 0.18s' }} />
              ))}
            </div>
          </>
        )}
      </div>
      {/* Insights + Boost */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid #262626', borderRadius: 8, margin: '10px 12px 0', backgroundColor: '#000' }}>
        <span style={{ fontSize: 13, color: '#8e8eef', fontWeight: 600 }}>View insights</span>
        <button style={{ backgroundColor: '#3232a8', color: '#b9b9d9', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Boost post</button>
      </div>
      {/* Action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 14px 0' }}>
        <button aria-label="Like" style={{ border: 'none', background: 'none', fontSize: 22, color: '#f5f5f5', cursor: 'pointer' }}>♡</button>
        <button aria-label="Comment" style={{ border: 'none', background: 'none', fontSize: 20, color: '#f5f5f5', cursor: 'pointer' }}>💬</button>
        <button aria-label="Repost" style={{ border: 'none', background: 'none', fontSize: 20, color: '#f5f5f5', cursor: 'pointer' }}>↻</button>
        <button aria-label="Send" style={{ border: 'none', background: 'none', fontSize: 20, color: '#f5f5f5', cursor: 'pointer' }}>▽</button>
        <span style={{ flex: 1 }} />
        <button aria-label="Save" style={{ border: 'none', background: 'none', fontSize: 22, color: '#f5f5f5', cursor: 'pointer' }}>🔖</button>
      </div>
      {/* Caption */}
      <div style={{ padding: '8px 14px 4px', fontSize: 13.5, lineHeight: 1.5, color: '#f5f5f5' }}>
        <span style={{ fontWeight: 700 }}>{displayUsername}</span>{' '}
        <span>{shown}</span>
      </div>
      <div style={{ padding: '8px 14px 16px', display: 'flex', justifyContent: 'center' }}>
        <span style={{ width: 52, height: 52, borderRadius: '50%', border: '2px solid transparent', borderTopColor: '#f59e0b', borderRightColor: '#e91e63', borderBottomColor: '#9c27b0', borderLeftColor: '#f59e0b', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#e91e63', fontSize: 20, fontWeight: 700 }}>✓</span>
      </div>
    </div>
  );
}
