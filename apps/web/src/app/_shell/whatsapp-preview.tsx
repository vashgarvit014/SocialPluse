'use client';

type Props = {
  communityName?: string;
  subtitle?: string;
  destinationType?: string;
  caption?: string;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  mediaList?: Array<{ url: string; type: 'image' | 'video' }>;
  currentSlide?: number;
  onSlideChange?: (idx: number) => void;
  aspectRatio?: string;
  isCarousel?: boolean;
  senderName?: string;
  senderRole?: string;
  logoUrl?: string;
  logoPosition?: string;
  logoScale?: number;
  logoOpacity?: number;
};

function aspectStyle(aspectRatio?: string): React.CSSProperties {
  if (aspectRatio === '9:16') return { aspectRatio: '9/16' };
  if (aspectRatio === '4:5') return { aspectRatio: '4/5' };
  if (aspectRatio === '16:9') return { aspectRatio: '16/9' };
  if (aspectRatio === '1.91:1') return { aspectRatio: '1.91/1' };
  return { aspectRatio: '1/1' };
}

export default function WhatsAppCommunityPreview({
  communityName = 'SocialPulse Testing 🚀',
  subtitle = 'Announcements',
  destinationType,
  caption = '',
  mediaUrl,
  mediaType = 'image',
  mediaList,
  currentSlide = 0,
  onSlideChange,
  aspectRatio = '1:1',
  isCarousel = false,
  senderName = 'You',
  senderRole = 'Community admin',
  logoUrl,
  logoPosition = 'bottom-right',
  logoScale = 0.18,
  logoOpacity = 1,
}: Props) {
  // PERMANENT RULE: WhatsApp is a no-hashtag channel. Strip every #tag
  // anywhere in the text and ignore the hashtags prop entirely, so the
  // preview always matches what will actually send (which is stripped too).
  const fullCaption = (caption || '').replace(/#[A-Za-z0-9_]+/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const displayCaption = fullCaption || 'Your WhatsApp message will appear here...';
  const slides = isCarousel && mediaList && mediaList.length > 1 ? mediaList : (mediaUrl ? [{ url: mediaUrl, type: mediaType }] : []);
  const idx = Math.min(currentSlide, Math.max(0, slides.length - 1));
  const active = slides[idx] as any;
  const hasMedia = !!active?.url;

  const label = destinationType === 'announcement_group' ? 'Community Announcement' : destinationType === 'community' ? 'Community' : 'Group Preview';

  return (
    <div style={{ width: 420, maxWidth: '100%', backgroundColor: '#0b141a', borderRadius: 16, overflow: 'hidden', border: '1px solid #1f2c34', boxShadow: '0 12px 32px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: 62, backgroundColor: '#202c33', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: '1px solid #2a3942' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#f0c419', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🚀</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e9edef', display: 'flex', alignItems: 'center', gap: 4 }}>{communityName}</div>
          <div style={{ fontSize: 12, color: '#8696a0' }}>{subtitle}</div>
        </div>
        <span style={{ fontSize: 11, color: '#8696a0', backgroundColor: '#2a3942', padding: '3px 7px', borderRadius: 999 }}>{label}</span>
        <button aria-label="Video call" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'none', color: '#aebac1', cursor: 'pointer' }}>📹</button>
        <button aria-label="Call" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'none', color: '#aebac1', cursor: 'pointer' }}>📞</button>
        <button aria-label="Menu" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'none', color: '#aebac1', fontSize: 18, cursor: 'pointer' }}>⋯</button>
      </div>
      {/* Wallpaper */}
      <div style={{ backgroundColor: '#0b141a', backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)`, backgroundSize: '24px 24px', padding: '16px 12px', minHeight: 380, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 360, backgroundColor: '#005c4b', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}>
          {/* Message header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', backgroundColor: '#1f4a3d', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#2a3942', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e9edef', fontSize: 12, overflow: 'hidden' }}>👤</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e9edef' }}>{senderName}</div>
              <div style={{ fontSize: 11, color: '#b8c5c0' }}>{senderRole}</div>
            </div>
            <span style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.12)', color: '#e9edef', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>⌄</span>
          </div>
          {/* Media */}
          {hasMedia ? (
            <div style={{ backgroundColor: '#000', position: 'relative', overflow: 'hidden', width: '100%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {active.type === 'video' ? (
                <div style={{ width: '100%', ...aspectStyle() }}>
                  <video src={active.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} muted playsInline />
                </div>
              ) : (
                // Fit the whole image (never crop): WhatsApp shows attached
                // photos fully inside the bubble regardless of their shape.
                // Tall portraits are capped so the bubble stays readable.
                <img src={active.url} alt={caption?.slice(0,80) || 'WhatsApp media'} style={{ maxWidth: '100%', maxHeight: 440, width: 'auto', height: 'auto', objectFit: 'contain', display: 'block', margin: '0 auto', backgroundColor: '#000' }} />
              )}
              {logoUrl && active.type !== 'video' && (
                <img src={logoUrl} alt="logo" style={{
                  position: 'absolute', width: `${Math.round(logoScale * 100)}%`, maxWidth: '28%', opacity: logoOpacity,
                  ...(logoPosition === 'top-left' ? { top: 10, left: 10 } : logoPosition === 'top-right' ? { top: 10, right: 10 } : logoPosition === 'bottom-left' ? { bottom: 10, left: 10 } : logoPosition === 'bottom-right' ? { bottom: 10, right: 10 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                  backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6, pointerEvents: 'none',
                }} />
              )}
              {isCarousel && slides.length > 1 && (
                <>
                  <button aria-label="Previous" onClick={() => onSlideChange?.(idx === 0 ? slides.length - 1 : idx - 1)} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer' }}>‹</button>
                  <button aria-label="Next" onClick={() => onSlideChange?.((idx + 1) % slides.length)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.45)', color: '#fff', cursor: 'pointer' }}>›</button>
                  <span style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999 }}>{idx+1}/{slides.length}</span>
                </>
              )}
            </div>
          ) : (
            <div style={{ height: 180, backgroundColor: '#111b21', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8696a0', fontSize: 12, flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 22 }}>🖼️</span> No media yet
            </div>
          )}
          {/* Caption */}
          <div style={{ backgroundColor: '#005c4b', padding: '10px 12px 8px', color: '#e9edef', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }}>
            {displayCaption}
          </div>
          {/* Footer time */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, padding: '2px 8px 6px', backgroundColor: '#005c4b' }}>
            <span style={{ fontSize: 11, color: '#b8c5c0' }}>{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <span style={{ fontSize: 11, color: '#b8c5c0' }}>✓✓</span>
          </div>
          {isCarousel && slides.length > 1 && (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', padding: '6px 0', backgroundColor: '#005c4b' }}>
              {slides.map((_, i) => (
                <span key={i} style={{ width: i===idx?12:6, height: 6, borderRadius: 999, backgroundColor: i===idx ? '#e9edef' : 'rgba(255,255,255,0.35)', transition: 'all 0.18s' }} />
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Outside reactions */}
      <div style={{ position: 'relative', height: 0 }}>
        <div style={{ position: 'absolute', left: 18, top: -28, display: 'flex', gap: 6 }}>
          <button aria-label="React" style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #2a3942', backgroundColor: '#202c33', color: '#e9edef', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>😊</button>
          <button aria-label="Share" style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #2a3942', backgroundColor: '#202c33', color: '#e9edef', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>↪️</button>
        </div>
      </div>
    </div>
  );
}
