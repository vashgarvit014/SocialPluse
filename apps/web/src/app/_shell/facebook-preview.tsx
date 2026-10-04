'use client';

type FBPreviewProps = {
  caption?: string;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  mediaList?: Array<{ url: string; type: 'image' | 'video' }>;
  pageName?: string;
  avatarUrl?: string;
  aspectRatio?: string;
};

function getMediaAspect(aspectRatio?: string): React.CSSProperties {
  if (aspectRatio === '9:16' || aspectRatio === '4:5') return { aspectRatio: '4/5' };
  if (aspectRatio === '16:9' || aspectRatio === '1.91:1') return { aspectRatio: '1.91/1' };
  return { aspectRatio: '1/1' };
}

function SingleMedia({ url, type, aspectRatio }: { url: string; type: string; aspectRatio?: string }) {
  const style = getMediaAspect(aspectRatio);
  return (
    <div style={{ ...style, width: '100%', overflow: 'hidden', backgroundColor: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {type === 'video' ? (
        <video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
      ) : (
        <img src={url} alt="Facebook post media" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
    </div>
  );
}

function MultiGrid({ items, aspectRatio }: { items: Array<{ url: string; type: string }>; aspectRatio?: string }) {
  const count = items.length;
  if (count === 2) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, backgroundColor: '#000' }}>
        {items.slice(0, 2).map((it, i) => (
          <div key={i} style={{ aspectRatio: '1/1', overflow: 'hidden', backgroundColor: '#000' }}>
            {it.type === 'video' ? <video src={it.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
        ))}
      </div>
    );
  }
  if (count === 3) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2, backgroundColor: '#000', height: 380 }}>
        <div style={{ gridRow: '1 / span 2', overflow: 'hidden', backgroundColor: '#000' }}>
          {items[0].type === 'video' ? <video src={items[0].url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={items[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        {items.slice(1, 3).map((it, i) => (
          <div key={i} style={{ overflow: 'hidden', backgroundColor: '#000' }}>
            {it.type === 'video' ? <video src={it.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
        ))}
      </div>
    );
  }
  if (count >= 4) {
    const shown = items.slice(0, 4);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2, backgroundColor: '#000', height: 380 }}>
        {shown.map((it, i) => (
          <div key={i} style={{ position: 'relative', overflow: 'hidden', backgroundColor: '#000' }}>
            {it.type === 'video' ? <video src={it.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            {i === 3 && count > 4 && (
              <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800 }}>+{count - 3}</div>
            )}
          </div>
        ))}
      </div>
    );
  }
  return <SingleMedia url={items[0].url} type={items[0].type} aspectRatio={aspectRatio} />;
}

export default function FacebookPostPreview({ caption = '', hashtags = [], mediaUrl, mediaType = 'image', mediaList, pageName = 'SocialPulse', avatarUrl, aspectRatio = '1:1' }: FBPreviewProps) {
  const tagString = hashtags.map(t => '#' + String(t).replace(/^#+/, '')).join(' ');
  const fullCaption = [caption?.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim(), tagString].filter(Boolean).join(' ');
  const displayCaption = fullCaption.length > 180 ? fullCaption.slice(0, 180) + '...' : fullCaption;
  const needsSeeMore = fullCaption.length > 180;
  const items = mediaList && mediaList.length ? mediaList : (mediaUrl ? [{ url: mediaUrl, type: mediaType }] : []);
  const hasMedia = items.length > 0;

  return (
    <div style={{ width: 540, maxWidth: '100%', backgroundColor: '#242526', borderRadius: 10, overflow: 'hidden', border: '1px solid #3a3b3c', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 14px', alignItems: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: avatarUrl ? `url(${avatarUrl}) center/cover` : '#3a86ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 16, flexShrink: 0, overflow: 'hidden' }}>{!avatarUrl && (pageName?.slice(0,1).toUpperCase() || 'S')}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e4e6eb' }}>{pageName}</div>
          <div style={{ fontSize: 11, color: '#b0b3b8', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>11 hours ago · <span style={{ fontSize: 11 }}>🌐</span></div>
        </div>
        <button aria-label="More" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'none', color: '#b0b3b8', fontSize: 18, cursor: 'pointer' }}>⋯</button>
      </div>
      {/* Caption */}
      <div style={{ padding: '0 14px 10px', fontSize: 14, lineHeight: 1.45, color: '#e4e6eb', whiteSpace: 'pre-wrap' as const }}>
        {displayCaption || 'Your caption will appear here...'}
        {needsSeeMore && <span style={{ color: '#e4e6eb', fontWeight: 600, cursor: 'pointer' }}> See more</span>}
      </div>
      {/* Media */}
      {hasMedia ? (
        items.length === 1 ? (
          <SingleMedia url={items[0].url} type={items[0].type} aspectRatio={aspectRatio} />
        ) : (
          <MultiGrid items={items} aspectRatio={aspectRatio} />
        )
      ) : (
        <div style={{ height: 200, backgroundColor: '#3a3b3c', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b0b3b8', fontSize: 12 }}>No media yet — add from Media</div>
      )}
      {/* Boost strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #3a3b3c', borderBottom: '1px solid #3a3b3c', backgroundColor: '#242526' }}>
        <span style={{ fontSize: 12, color: '#b0b3b8', display: 'flex', alignItems: 'center', gap: 6 }}><span>📢</span> Boost this post to get more reach for <span style={{ color: '#e4e6eb', fontWeight: 600 }}>{pageName}</span>.</span>
        <button style={{ backgroundColor: '#2374e1', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>पोस्ट को प्रमोट करें · Promote post</button>
      </div>
      {/* Like / Comment / Share */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '6px 12px', borderBottom: '1px solid #3a3b3c' }}>
        <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', border: 'none', background: 'none', color: '#b0b3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}><span>👍</span> Like</button>
        <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', border: 'none', background: 'none', color: '#b0b3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}><span>💬</span> Comment</button>
        <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', border: 'none', background: 'none', color: '#b0b3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}><span>↗️</span> Share</button>
      </div>
      {/* Comment box */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', alignItems: 'center', backgroundColor: '#242526' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#3a3b3c', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b0b3b8', flexShrink: 0 }}>👤</div>
        <div style={{ flex: 1, backgroundColor: '#3a3b3c', borderRadius: 20, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 13, color: '#b0b3b8' }}>Comment as Dot Stark</span>
          <span style={{ fontSize: 14, color: '#b0b3b8' }}>😊</span><span style={{ fontSize: 14, color: '#b0b3b8' }}>📷</span><span style={{ fontSize: 12, color: '#b0b3b8', border: '1px solid #5e6771', borderRadius: 4, padding: '1px 4px' }}>GIF</span>
        </div>
      </div>
      <div style={{ padding: '0 14px 10px 54px', fontSize: 11, color: '#b0b3b8', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#f0c419' }}>⚠️</span> You’re commenting as Dot Stark.</div>
    </div>
  );
}
