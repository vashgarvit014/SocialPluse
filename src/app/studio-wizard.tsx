'use client';

import { useState, useEffect, useRef } from 'react';
import type { StudioWorkspaceProps } from './studio-workspace';
import type { MediaItem } from './page';

// ---------------------------------------------------------------------------
// Tokens (same SaaS system as studio-workspace)
// ---------------------------------------------------------------------------
const C = {
  card: '#ffffff',
  border: '#E8EAF1',
  borderSoft: '#F1F3F9',
  ink: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  primarySoft: '#F1EBFF',
  primaryBorder: '#C4B5FD',
};

const card: React.CSSProperties = {
  backgroundColor: C.card,
  borderRadius: 16,
  border: `1px solid ${C.border}`,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 28px rgba(15,23,42,0.06)',
  overflow: 'hidden',
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  minHeight: 42, padding: '10px 20px', borderRadius: 10,
  fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit', transition: 'all 0.18s',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  border: 'none',
  background: disabled ? '#DDD6FE' : 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
  color: '#fff',
  boxShadow: disabled ? 'none' : '0 3px 12px rgba(124,58,237,0.28)',
});

const ghostBtn: React.CSSProperties = {
  minHeight: 42, padding: '10px 18px', borderRadius: 10,
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', transition: 'all 0.18s',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  border: `1.5px solid ${C.border}`, backgroundColor: '#fff', color: '#334155',
};

const selectCard = (active: boolean): React.CSSProperties => ({
  padding: 14, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
  border: active ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
  background: active ? C.primarySoft : '#fff',
  boxShadow: active ? '0 3px 12px rgba(124,58,237,0.14)' : 'none',
  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
  transition: 'all 0.18s',
});

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{children}</div>
      {hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function WizardNav({ onBack, backLabel = '← Back', next }: { onBack?: () => void; backLabel?: string; next: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.borderSoft}` }}>
      <div style={{ flex: 1 }}>
        {onBack && <button onClick={onBack} style={ghostBtn}>{backLabel}</button>}
      </div>
      {next}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------
const STEPS = [
  { n: 1, t: 'Idea' },
  { n: 2, t: 'Settings' },
  { n: 3, t: 'Content' },
  { n: 4, t: 'Media' },
  { n: 5, t: 'Preview' },
  { n: 6, t: 'Publish' },
];

function WizardStepper({ step, go }: { step: number; go: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, overflowX: 'auto', padding: '4px 2px' }}>
      {STEPS.map((s, i) => {
        const done = s.n < step;
        const active = s.n === step;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 96 }}>
            <button
              onClick={() => { if (s.n < step) go(s.n); }}
              disabled={s.n > step}
              style={{ background: 'none', border: 'none', cursor: s.n < step ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8, padding: 0, fontFamily: 'inherit' }}
              title={s.n < step ? `Go back to ${s.t}` : s.t}
            >
              <span style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: done ? C.primary : active ? 'linear-gradient(135deg,#7C3AED,#8B5CF6)' : '#EEF0F6',
                color: done || active ? '#fff' : '#9AA1B5',
                boxShadow: active ? '0 3px 10px rgba(124,58,237,0.35)' : 'none',
              }}>{done ? '✓' : s.n}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: active ? C.primaryDark : done ? C.ink : '#9AA1B5' }}>{s.t}</span>
            </button>
            {i < STEPS.length - 1 && <span style={{ flex: 1, height: 2, borderRadius: 2, margin: '0 10px', background: s.n < step ? C.primary : '#E9ECF3', minWidth: 12 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 (Media & Branding) helpers — presentation only, all actions via props
// ---------------------------------------------------------------------------
type MediaSource = 'ai' | 'upload' | 'canva';

// Source is derived from how the item landed in the gallery: AI generations
// are stored with name 'generated', Canva imports with 'canva-edit',
// uploads keep their real filenames.
function mediaSource(m: MediaItem): MediaSource {
  const n = (m.name || '').toLowerCase();
  if (n.includes('canva')) return 'canva';
  if (n === 'generated') return 'ai';
  return 'upload';
}

function mediaFileName(m: MediaItem): string {
  if (!m.name) return m.type === 'video' ? 'Untitled video' : 'Untitled image';
  if (m.name === 'generated') return 'AI generated image';
  if (m.name === 'canva-edit') return 'Canva design';
  return m.name;
}

const SOURCE_META: Record<MediaSource, { label: string; bg: string; color: string; border: string }> = {
  ai: { label: '✨ AI Generated', bg: '#F1EBFF', color: '#6D28D9', border: '#C4B5FD' },
  upload: { label: 'Uploaded', bg: '#F1F5F9', color: '#475569', border: '#E2E8F0' },
  canva: { label: 'Canva Edited', bg: '#E0F7FA', color: '#0E7490', border: '#A5F3FC' },
};

// Reads natural dimensions without rendering a second visible element —
// data: URLs resolve from memory, remote URLs hit the browser cache.
function MediaDims({ url, type }: { url: string; type: 'image' | 'video' }) {
  const [dims, setDims] = useState('');
  useEffect(() => {
    let live = true;
    if (type === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { if (live && v.videoWidth) setDims(`${v.videoWidth}×${v.videoHeight}`); };
      v.onerror = () => { if (live) setDims(''); };
      v.src = url;
    } else {
      const im = new Image();
      im.onload = () => { if (live && im.naturalWidth) setDims(`${im.naturalWidth}×${im.naturalHeight}`); };
      im.onerror = () => { if (live) setDims(''); };
      im.src = url;
    }
    return () => { live = false; };
  }, [url, type]);
  if (!dims) return null;
  return <> • {dims}</>;
}

const BRAND_SWATCHES = ['#7C3AED', '#0F172A', '#0A66C2', '#E2E8F0'];
const EXTRA_SWATCHES = ['#EC4899', '#10B981', '#F59E0B', '#EF4444', '#14B8A6'];

// ---------------------------------------------------------------------------
// Wizard — presentation only, all logic via props (existing handlers)
// ---------------------------------------------------------------------------
export default function StudioWizard(p: StudioWorkspaceProps) {
  function field<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const value = (p.wizardState[key] === undefined ? initial : p.wizardState[key]) as T;
    return [value, next => p.setWizardState(prev => ({ ...prev, [key]: typeof next === 'function' ? (next as (v: T) => T)((prev[key] === undefined ? initial : prev[key]) as T) : next }))];
  }
  const [currentStep, setCurrentStep] = field('currentStep', 1);
  const [publishMode, setPublishMode] = field<'now' | 'later'>('publishMode', 'now');
  const [studioTab, setStudioTab] = field<'caption' | 'hashtags' | 'prompt'>('studioTab', 'caption');
  const [previewPlatform, setPreviewPlatform] = field('previewPlatform', 'linkedin');
  const [showCancelPreview, setShowCancelPreview] = useState(false);
  const [isCancellingPreview, setIsCancellingPreview] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  // Step 5's feed mockup deliberately crops media with objectFit:'cover' to
  // simulate the real platform crop - this holds the item clicked open in a
  // full, uncropped lightbox on top of that, without touching the mockup.
  const [lightboxItem, setLightboxItem] = useState<{ url: string; type: 'image' | 'video'; altText?: string } | null>(null);
  // Carousel swipe-preview position (Step 5). Clamped against the live slide
  // list at render time so removing slides can never strand it out of range.
  const [carouselPreviewIndex, setCarouselPreviewIndex] = field('carouselPreviewIndex', 0);
  // ---- Step 4 local UI state (selection/filters/menus/previews only) ----
  // Gallery card selection drives "Edit Selected in Canva". Null = nothing
  // clicked yet, in which case the first gallery image is the edit target.
  const [selectedMediaId, setSelectedMediaId] = field<string | null>('selectedMediaId', null);
  const [galleryFilter, setGalleryFilter] = field<'all' | 'ai' | 'upload' | 'canva' | 'branded'>('galleryFilter', 'all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dragSlideId, setDragSlideId] = useState<string | null>(null);
  const [dragOverSlideId, setDragOverSlideId] = useState<string | null>(null);
  const [showSlidePicker, setShowSlidePicker] = useState(false);
  // Slide overflow menu floats above everything (fixed position from the
  // button's viewport rect) because the horizontal strip clips overflowing
  // children — an absolutely-positioned menu would be cut off mid-scroll.
  const [slideMenu, setSlideMenu] = useState<{ id: string; x: number; y: number } | null>(null);  const [brandSwatches, setBrandSwatches] = field<string[]>('brandSwatches', BRAND_SWATCHES);
  const [activeSwatch, setActiveSwatch] = field<string>('activeSwatch', BRAND_SWATCHES[0]);
  const [headingFont, setHeadingFont] = field('headingFont', 'Poppins');
  const [bodyFont, setBodyFont] = field('bodyFont', 'Inter');

  // Reference (topic) images ride along into the Step 5 preview and the
  // publish payload (deduped by URL) - skipped when the post carries video.
  // Carousel mode overrides: the slide order IS the explicit selection.
  const postExtraImages = p.topicMediaItems.filter(t => t.type === 'image' && !p.mediaItems.some(m => m.url === t.url));
  const postHasVideoItem = p.mediaItems.some(m => m.type === 'video') || !!p.generatedVideo;
  const postPublishMedia = (p.isCarousel ? p.carouselSlides : (postHasVideoItem ? p.mediaItems : [...p.mediaItems, ...postExtraImages])).slice(0, 9);
  const accessibilityMedia = currentStep === 4 ? [...p.mediaItems, ...postExtraImages] : postPublishMedia;
  const previewItems: MediaItem[] = postPublishMedia.length
    ? postPublishMedia.slice(0, 4)
    : p.generatedVideo
      ? [{ id: 'v', url: p.generatedVideo, type: 'video' as const }]
      : [{ id: 'i', url: p.generatedImage, type: 'image' as const }];
  const previewMediaCount = postPublishMedia.length || ((p.generatedImage || p.generatedVideo) ? 1 : 0);

  // ---- Step 4 derived: gallery selection → Canva edit target ----
  // Nothing clicked yet: the first gallery image is the target (matches the
  // previous "generated image, else first image" default). A clicked video
  // disables image-based editing with an explanatory tooltip.
  const selectedMedia = p.mediaItems.find(m => m.id === selectedMediaId) || null;
  const canvaEditTarget = selectedMedia
    ? (selectedMedia.type === 'image' ? selectedMedia : null)
    : p.mediaItems.find(m => m.type === 'image');

  // Auto-advance: when AI content finishes generating, move to Step 3 (review)
  const wasGeneratingContent = useRef(false);
  useEffect(() => {
    if (wasGeneratingContent.current && !p.isGeneratingContent && p.content.trim() && currentStep === 2) {
      setCurrentStep(3);
    }
    wasGeneratingContent.current = p.isGeneratingContent;
  }, [p.isGeneratingContent, p.content, currentStep]);

  const hasTopic = !!p.prompt.trim() || p.topicMediaItems.length > 0;
  const hasSettings = !!p.aspectRatio;
  const hasContent = !!p.content.trim();
  const hasMedia = p.mediaItems.length > 0 || !!p.generatedImage || !!p.generatedVideo;
  // Publishing needs a CONNECTED platform (the OAuth token actually posts).
  // Unlike generation, selection alone is not enough here.
  const connectedSelected = p.selectedPlatforms.filter(pl =>
    pl === 'whatsapp' ? p.whapiConnected : p.accounts.some(a => a.platform === pl && a.connected));
  // Carousel posts additionally need 2+ image slides before publishing.
  const canPublish = hasContent && connectedSelected.length > 0 && (!p.isCarousel || p.carouselValidation.valid);
  const publishBlocker = !hasContent
    ? 'Generate content first'
    : p.selectedPlatforms.length === 0
      ? 'Select a platform above first'
      : p.isCarousel && !p.carouselValidation.valid
        ? p.carouselValidation.reason
        : 'Connect the selected platform first';
  // Content generation needs only a SELECTED platform - no connection
  // required (connection is only needed later, to publish). Any selected
  // platform unlocks it, so the button state stays honest.
  const genPlatformSelected = p.selectedPlatforms.length > 0;
  const canGenContent = !p.isGeneratingContent && hasTopic && genPlatformSelected;
  const genContentBlocker = !hasTopic
    ? 'Enter a topic first (Step 1)'
    : !genPlatformSelected
      ? 'Select a platform above first — then Generate Content unlocks'
      : '';
  const canGenImage = !p.isGeneratingImage && !!p.aspectRatio && !!p.content.trim();

  const activeTags = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
  const sentences = p.content ? p.content.split(/[.!?]+/).filter(s => s.trim()).length : 0;

  const saveDraft = p.saveFullDraft;

  const goNext = () => setCurrentStep(s => Math.min(6, s + 1));
  const goBack = () => setCurrentStep(s => Math.max(1, s - 1));

  const header = (title: string, sub: string, badge?: string) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>{title}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{sub}</div>
      </div>
      {badge && <span style={{ fontSize: 11, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '7px 11px', borderRadius: 9, maxWidth: 230, lineHeight: 1.5 }}>{badge}</span>}
    </div>
  );

  const altTextControls = (
    <section style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, margin: 0, color: C.ink }}>Image ALT text</h3>
        <span style={{ fontSize: 11, color: C.muted }}>Descriptions stay with your images.</span>
      </div>
      {accessibilityMedia.filter(m => m.type === 'image').map((m, i) => <details key={m.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.ink }}>Image {i + 1} · {m.altText?.trim() ? 'ALT added' : 'ALT missing'}</summary>
        <img src={m.url} alt={m.altText || ''} style={{ width: 120, height: 90, objectFit: 'contain' }} />
        <textarea aria-label={`ALT text for image ${i + 1}`} value={m.altText || ''} maxLength={1000} onChange={e => p.updateAltText(m.id, e.target.value)} rows={3} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 12, margin: '8px 0', borderRadius: 8, border: `1px solid ${C.border}`, font: 'inherit', fontSize: 13, lineHeight: 1.5 }} />
        <button style={{ ...ghostBtn, marginRight: 8 }} disabled={p.altBusy} onClick={() => p.generateAltText([m])}>Generate ALT Text</button>
        <button style={ghostBtn} onClick={() => p.updateAltText(m.id, '')}>Clear</button>
      </details>)}
      <button style={{ ...ghostBtn, minHeight: 34, fontSize: 11, opacity: p.altBusy ? .6 : 1 }} disabled={p.altBusy || !accessibilityMedia.some(m => m.type === 'image' && !m.altText?.trim())} onClick={() => p.generateAltText(accessibilityMedia.filter(m => m.type === 'image' && !m.altText?.trim()))}>{p.altBusy ? 'Describing images…' : 'Generate Missing ALT Text'}</button>
    </section>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, flex: 1, alignItems: 'stretch', minHeight: 'calc(100vh - 64px)', maxWidth: 1120, width: '100%', margin: '0 auto' }}>
      <style>{`
        .sp-wiz-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sp-wiz-prev { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 14px; align-items: start; }
        .sp-wiz-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .sp-wiz-title2 { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
        .sp-wiz-media2 { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; align-items: stretch; }
        @media (max-width: 900px) { .sp-wiz-grid2, .sp-wiz-prev, .sp-wiz-media2 { grid-template-columns: 1fr; } }
        @media (max-width: 700px) { .sp-wiz-grid3 { grid-template-columns: 1fr; } }
      `}</style>

      <div style={{ ...card, padding: '14px 20px' }}>
        <WizardStepper step={currentStep} go={setCurrentStep} />
      </div>

      <div style={{ ...card, padding: '28px 32px' }}>
        {/* ================= STEP 1 — IDEA ================= */}
        {currentStep === 1 && (
          <div>
            {header('Create Your Post', 'Step 1 of 6: Tell us what you want to create', 'A great idea leads to great content! Be specific for better results.')}
            <SectionTitle>Topic & Idea</SectionTitle>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>Describe your post idea, topic, or key message. The more details you provide, the better the results.</div>
            <textarea
              value={p.prompt}
              onChange={e => p.setPrompt(e.target.value.slice(0, 2000))}
              placeholder="Describe the social media post you want to create..."
              style={{ width: '100%', minHeight: 130, padding: '13px 14px', border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13, lineHeight: 1.65, color: C.ink, backgroundColor: '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: C.faint, fontStyle: 'italic' }}>Example: “5 tips for staying productive while working from home, target audience is remote professionals, friendly tone”</span>
              <span style={{ fontSize: 11, color: C.faint, flexShrink: 0, marginLeft: 12 }}>{p.prompt.length}/500</span>
            </div>

            <div style={{ marginTop: 20 }}>
              <SectionTitle>Reference Images (Optional)</SectionTitle>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Upload up to 4 images to guide AI and match your vision.</div>
              <div
                onDragOver={p.handleDragOver}
                onDragEnter={e => { e.preventDefault(); p.setDragOverTopic(true); p.setTopicDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); p.setDragOverTopic(false); p.setTopicDragOver(false); }}
                onDrop={p.handleTopicDrop}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}
              >
                {p.topicMediaItems.filter(i => i.type === 'image').map(item => (
                  <div key={item.id} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, aspectRatio: '1', backgroundColor: '#000' }}>
                    <img src={item.url} alt={item.altText || item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <button onClick={() => p.removeTopicMedia(item.id)} style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', backgroundColor: 'rgba(15,23,42,0.78)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                    <button onClick={() => p.openInCanva(item.url)} disabled={p.isSendingToCanva} title="Edit this image in Canva" style={{ position: 'absolute', bottom: 5, right: 5, height: 20, padding: '0 7px', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)', color: '#0F172A', border: '1px solid #E2E8F0', cursor: p.isSendingToCanva ? 'wait' : 'pointer', fontSize: 10, fontWeight: 800 }}>🎨 Edit</button>
                  </div>
                ))}
                {p.topicMediaItems.length < 4 && (
                  <button onClick={() => p.topicFileInputRef.current?.click()} style={{ borderRadius: 10, border: '1.5px dashed #C4B5FD', backgroundColor: C.primarySoft, cursor: 'pointer', aspectRatio: '1', color: C.primary, fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                )}
              </div>
              <input ref={p.topicFileInputRef} type="file" accept="image/*" multiple onChange={p.handleTopicUpload} style={{ display: 'none' }} />
            </div>

            <WizardNav next={<button onClick={goNext} disabled={!hasTopic} style={primaryBtn(!hasTopic)} title={!hasTopic ? 'Enter a topic or add a reference image first' : 'Continue'}>Next →</button>} />
            {!hasTopic && <div style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>Topic required — describe your post or add a reference image to continue.</div>}
          </div>
        )}

        {/* ================= STEP 2 — SETTINGS ================= */}
        {currentStep === 2 && (
          <div>
            {header('Creative Settings', 'Step 2 of 6: Customize your content style', 'Choose settings that match your audience and platform.')}
            <SectionTitle>Tone</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              {[['Professional', '💼'], ['Casual', '😊'], ['Inspirational', '✨'], ['Educational', '📚']].map(([k, i]) => {
                const active = p.tone === k;
                return (
                  <button key={k} onClick={() => p.setTone(k)} style={selectCard(active)}>
                    <span style={{ fontSize: 18 }}>{i}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? C.primaryDark : C.ink }}>{k}</span>
                    <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: '50%', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? C.primary : '#fff', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            <SectionTitle>Image Style</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              {[['Photographic', '📷'], ['Digital Art', '🎨'], ['Cinematic', '🎬'], ['Anime', '🌸']].map(([k, i]) => {
                const active = p.imageStyle === k;
                return (
                  <button key={k} onClick={() => p.setImageStyle(k)} style={selectCard(active)}>
                    <span style={{ fontSize: 18 }}>{i}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? C.primaryDark : C.ink }}>{k}</span>
                    <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: '50%', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? C.primary : '#fff', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            <SectionTitle>Aspect Ratio</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.entries(p.aspectRatioMap).map(([key, val]) => {
                const active = p.aspectRatio === key;
                return (
                  <button key={key} onClick={() => p.setAspectRatio(key)} style={selectCard(active)}>
                    <span style={{
                      width: key === '1:1' ? 26 : key === '16:9' ? 34 : key === '9:16' ? 18 : 28,
                      height: key === '1:1' ? 26 : key === '16:9' ? 19 : key === '9:16' ? 30 : 21,
                      borderRadius: 5, border: `2px solid ${active ? C.primary : '#CBD5E1'}`,
                      backgroundColor: active ? '#fff' : '#F8FAFC', flexShrink: 0, display: 'block',
                    }} />
                    <span>
                      <span style={{ display: 'block', fontSize: 9, fontWeight: 800, color: active ? C.primaryDark : C.muted }}>{key}</span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: active ? C.primaryDark : C.ink }}>{val.label}</span>
                    </span>
                    <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: '50%', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? C.primary : '#fff', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>PLATFORM {p.accounts.some(a => a.connected) ? (
                <span style={{ fontWeight: 600, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '1px 7px', borderRadius: 999 }}>Active</span>
              ) : (
                <span style={{ fontWeight: 600, color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '1px 7px', borderRadius: 999 }}>Connect to continue</span>
              )}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  { id: 'linkedin', label: 'LinkedIn' },
                  { id: 'facebook', label: 'Facebook' },
                  { id: 'instagram', label: 'Instagram' },
                  { id: 'whatsapp', label: 'WhatsApp' },
                ] as const).map(cfg => {
                  const standby = false;
                  const isWhapi = cfg.id === 'whatsapp';
                  const connected = isWhapi ? p.whapiConnected : p.accounts.some(a => a.platform === cfg.id && a.connected);
                  const selected = p.selectedPlatforms.includes(cfg.id);
                  const brand = p.platformColors[cfg.id] || C.primary;
                  return (
                    <div key={cfg.id} style={{ display: 'flex', gap: 8, alignItems: 'stretch', opacity: standby ? 0.6 : 1 }}>
                      <button onClick={() => { if (!standby) p.togglePlatform(cfg.id); }} disabled={standby} style={{
                        flex: 1, padding: 10, borderRadius: 10, cursor: standby ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                        border: selected && !standby ? `1.5px solid ${brand}` : `1px solid ${C.border}`,
                        backgroundColor: selected && !standby ? '#EFF6FF' : '#fff',
                      }}>
                        <span style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <p.PlatformIcon platform={cfg.id} size={13} />
                        </span>
                        <span>
                          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink }}>{cfg.label} {selected && !standby ? '✓' : ''}</span>
                          <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: standby ? '#B45309' : connected ? '#059669' : C.faint }}>{standby ? 'On standby' : connected ? '● Connected' : '○ Not connected'}</span>
                        </span>
                      </button>
                      {!connected && !standby && !isWhapi && (
                        <button onClick={() => p.connectPlatform(cfg.id)} style={{ padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>Connect</button>
                      )}
                      {!connected && !standby && isWhapi && (
                        <button onClick={() => p.startWhatsAppConnect()} style={{ padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>Connect</button>
                      )}
                      {connected && !standby && !isWhapi && (
                        <button onClick={() => p.disconnectPlatform(cfg.id)} style={{ padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Disconnect</button>
                      )}
                      {connected && !standby && isWhapi && (
                        <button onClick={() => p.disconnectWhatsApp()} disabled={p.whatsappDisconnecting || p.whapiLoading} style={{ padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: (p.whatsappDisconnecting || p.whapiLoading) ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: (p.whatsappDisconnecting || p.whapiLoading) ? 0.6 : 1 }}>{p.whatsappDisconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <WizardNav
              onBack={goBack}
              next={<span style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { p.generateContent(); }} disabled={!canGenContent} title={!canGenContent ? genContentBlocker : 'Generate content'} style={primaryBtn(!canGenContent)}>✨ Generate Content →</button>
                <button onClick={goNext} disabled={!hasSettings} title={!hasSettings ? 'Choose an aspect ratio to continue' : 'Continue'} style={{ ...primaryBtn(!hasSettings), background: hasSettings ? '#0F172A' : '#DDD6FE', boxShadow: 'none' }}>Next →</button>
              </span>}
            />
            {!hasSettings && <div style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>Aspect ratio required before the image flow — pick one above.</div>}
            {!canGenContent && !p.isGeneratingContent && (
              <div style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>
                To enable Generate Content: {[!hasTopic ? 'add a topic (Step 1)' : null, !genPlatformSelected ? 'select a platform above' : null].filter(Boolean).join(' and ')}.
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 3 — CONTENT ================= */}
        {currentStep === 3 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>AI Content Editor</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Step 3 of 6: Review and refine your generated content</div>
              </div>
              <button onClick={p.generateContent} disabled={!canGenContent} style={{ padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: `1px solid ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, cursor: canGenContent ? 'pointer' : 'not-allowed', opacity: canGenContent ? 1 : 0.5 }}>↻ Regenerate</button>
            </div>
            {!p.content.trim() ? (
              <div style={{ border: '1.5px dashed #C4B5FD', borderRadius: 12, backgroundColor: '#FCFCFE', padding: 36, textAlign: 'center' }}>
                <div style={{ fontSize: 30 }}>📝</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 8 }}>No content yet</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Go back to Settings and click Generate Content.</div>
                <button onClick={() => setCurrentStep(2)} style={{ ...primaryBtn(false), width: 'auto', marginTop: 14, padding: '10px 20px' }}>← Back to Settings</button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.borderSoft}`, marginBottom: 12 }}>
                  {([['caption', 'Caption'], ['hashtags', 'Hashtags'], ['prompt', 'Image Prompt']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setStudioTab(k)} style={{ padding: '9px 15px', fontSize: 12, fontWeight: 700, border: 'none', borderBottom: studioTab === k ? `2px solid ${C.primary}` : '2px solid transparent', background: 'none', color: studioTab === k ? C.primaryDark : C.faint, cursor: 'pointer' }}>{label}</button>
                  ))}
                </div>
                {studioTab === 'caption' && (
                  <div>
                    <div style={{ fontSize: 11, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '7px 11px', borderRadius: 8, marginBottom: 10 }}>✨ AI-generated suggestion — review and edit before publishing.</div>
                    <textarea value={p.content} onChange={e => {
                      const v = e.target.value;
                      p.setContent(v);
                      // Write edits back so Publish sends the current edited caption, never a stale value.
                      if (p.activePreviewPlatform && p.platformContent[p.activePreviewPlatform]) {
                        p.setPlatformContent({
                          ...p.platformContent,
                          [p.activePreviewPlatform]: {
                            ...p.platformContent[p.activePreviewPlatform],
                            caption: v.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim(),
                          },
                        });
                      }
                    }} style={{ width: '100%', minHeight: 210, padding: 14, border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13.5, lineHeight: 1.75, color: C.ink, backgroundColor: '#fff', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                    <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: C.muted }}>
                      <span><b style={{ color: C.primaryDark }}>{p.charCount}</b> characters</span>
                      <span><b style={{ color: C.primaryDark }}>{p.wordCount}</b> words • ~{Math.max(1, Math.ceil(p.wordCount / 200))} min read</span>
                      <span style={{ marginLeft: 'auto' }}>{sentences} sentences • LinkedIn-ready</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => { try { navigator.clipboard.writeText(p.content); setCopiedText(true); setTimeout(() => setCopiedText(false), 2000); } catch {} }} style={{ padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: `1.5px solid ${C.border}`, backgroundColor: copiedText ? '#ECFDF5' : '#fff', color: copiedText ? '#059669' : C.ink, cursor: 'pointer' }}>📋 {copiedText ? 'Copied ✓' : 'Copy text'}</button>
                    </div>
                  </div>
                )}
                {studioTab === 'hashtags' && (
                  <div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {activeTags.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>Hashtags appear here after generation.</span>}
                      {activeTags.map((t, i) => (
                        <button key={i} onClick={() => { try { navigator.clipboard.writeText('#' + String(t).replace(/^#+/, '')); } catch {} }} title="Click to copy" style={{ fontSize: 12, fontWeight: 600, backgroundColor: C.primarySoft, color: C.primaryDark, border: `1px solid ${C.primaryBorder}`, padding: '6px 12px', borderRadius: 999, cursor: 'pointer' }}>#{String(t).replace(/^#+/, '')}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>From generate-content — click a chip to copy.</div>
                  </div>
                )}
                {studioTab === 'prompt' && (
                  <div>
                    <textarea value={p.imagePrompt} onChange={() => {}} placeholder="Image prompt appears here…" style={{ width: '100%', minHeight: 120, padding: 14, border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13, lineHeight: 1.7, color: C.ink, backgroundColor: '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Powers Generate AI Image with your Image Style + Aspect Ratio.</div>
                  </div>
                )}
                <div className="sp-wiz-grid2" style={{ marginTop: 16 }}>
                  <div style={{ backgroundColor: '#F8FAFC', border: `1px solid ${C.borderSoft}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Suggested Hashtags</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {activeTags.slice(0, 8).map((t, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, backgroundColor: '#fff', color: C.primaryDark, border: `1px solid ${C.primaryBorder}`, padding: '4px 9px', borderRadius: 999 }}>#{String(t).replace(/^#+/, '')}</span>
                      ))}
                      {activeTags.length === 0 && <span style={{ fontSize: 11, color: C.faint }}>#Productivity #RemoteWork #Growth</span>}
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 8 }}>AI Suggestions</div>
                    <div style={{ fontSize: 11, color: '#92400E', lineHeight: 1.8 }}>
                      • Consider a stronger call-to-action<br />
                      • Try a shorter opening sentence<br />
                      • Add a personal example
                    </div>
                  </div>
                </div>
              </div>
            )}
            <WizardNav onBack={goBack} next={<button onClick={goNext} disabled={!hasContent} style={primaryBtn(!hasContent)} title={!hasContent ? 'Generate content first' : 'Continue'}>Next →</button>} />
          </div>
        )}

        {/* ================= STEP 4 — MEDIA ================= */}
        {currentStep === 4 && (
          <div>
            <div className="sp-wiz-title2" style={{ marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Media & Branding</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Add visuals, edit with Canva, and apply your brand identity.</div>
              </div>
              <button onClick={saveDraft} style={{ ...ghostBtn, minHeight: 34, fontSize: 12 }}>💾 Save Draft</button>
            </div>
            {p.generationError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', borderRadius: 10, marginBottom: 12 }}>
                <span style={{ flex: 1 }}>⚠️ {p.generationError}</span>
                <button onClick={() => p.setGenerationError('')} style={{ border: 'none', background: 'none', color: '#B91C1C', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '0 2px' }}>×</button>
              </div>
            )}
            {/* ---- Add Media ---- */}
            <div style={{ ...card, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Add Media</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Upload your own files or generate AI visuals — JPG, PNG, MP4, MOV.</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: p.mediaItems.length >= 9 ? '#B45309' : C.muted, backgroundColor: p.mediaItems.length >= 9 ? '#FFFBEB' : '#F1F3F9', border: `1px solid ${p.mediaItems.length >= 9 ? '#FDE68A' : C.border}` }}>
                  {p.mediaItems.length}/9 files
                </span>
              </div>
              <div className="sp-wiz-media2">
                <div
                  onClick={() => p.fileInputRef.current?.click()}
                  onDragOver={p.handleDragOver}
                  onDragEnter={e => { e.preventDefault(); p.setDragOverPreview(true); }}
                  onDragLeave={e => { e.preventDefault(); p.setDragOverPreview(false); }}
                  onDrop={p.handleDrop}
                  style={{ borderRadius: 8, border: p.dragOverPreview ? `1.5px dashed ${C.primary}` : `1.5px dashed #CBD5E1`, backgroundColor: p.dragOverPreview ? C.primarySoft : '#FCFCFE', padding: 16, textAlign: 'center', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 110 }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#EDE9FE', color: C.primaryDark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>☁️</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Drag & drop images or videos here</div>
                  <div style={{ fontSize: 11, color: C.muted }}>or <span style={{ color: C.primaryDark, fontWeight: 700 }}>browse files</span> • Max 10MB images / 50MB videos • 9 files max</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                  <button onClick={() => p.fileInputRef.current?.click()} style={{ ...ghostBtn, width: '100%' }}>📤 Upload Media</button>
                  <button onClick={p.generateImage} disabled={!canGenImage} title={!p.aspectRatio ? 'Choose aspect ratio in Settings first' : 'Generate AI image'} style={{ ...primaryBtn(!canGenImage), width: '100%' }}>
                    {p.isGeneratingImage ? 'Generating…' : '✨ Generate AI Image'}
                  </button>
                  <div style={{ fontSize: 10, color: C.faint, textAlign: 'center', lineHeight: 1.5 }}>{!p.aspectRatio ? 'Choose an aspect ratio in Settings to unlock AI generation.' : 'AI images land in Recent Media below.'}</div>
                </div>
              </div>
            </div>

            {/* ---- Design with Canva (featured, native-feeling) ---- */}
            {/* Edit sends an image to Canva; Import brings the edited result
                back as a NEW gallery item (never overwrites). All calls go
                through the existing /api/canva/* routes unchanged. */}
            <div style={{ marginTop: 12, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, background: '#F8FAFC' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#00C4CC,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>C</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Design with Canva</span>
                    {p.canvaConnected ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0' }}>● Connected{p.canvaName ? ` as ${p.canvaName}` : ''}</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: C.muted, backgroundColor: '#fff', border: `1px solid ${C.border}` }}>Not connected</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5, marginBottom: 10 }}>Create or edit a design, then import it into your gallery.</div>
                  {!p.canvaConnected ? (
                    <button onClick={() => p.openInCanva()} style={{ ...primaryBtn(false), width: 'auto', padding: '10px 20px' }}>Connect Canva →</button>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <button
                        onClick={p.createInCanva}
                        disabled={p.isCreatingInCanva}
                        title="Start a blank design in Canva and build it with Canva's own tools"
                        style={{ textAlign: 'left', padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, backgroundColor: '#fff', cursor: p.isCreatingInCanva ? 'wait' : 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}
                      >
                        <div style={{ fontSize: 16 }}>➕</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginTop: 4 }}>{p.isCreatingInCanva ? 'Creating…' : 'Create in Canva'}</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>Start a new design from scratch</div>
                      </button>
                      <button
                        onClick={() => { if (canvaEditTarget) p.openInCanva(canvaEditTarget.url); }}
                        disabled={p.isSendingToCanva || !canvaEditTarget}
                        title={!canvaEditTarget ? (selectedMedia ? 'Select an image (not a video) to edit' : 'Generate or upload an image first') : `Open “${mediaFileName(canvaEditTarget)}” in Canva`}
                        style={{ textAlign: 'left', padding: 12, borderRadius: 12, border: `1px solid ${!canvaEditTarget ? C.border : C.primaryBorder}`, backgroundColor: '#fff', cursor: (!canvaEditTarget || p.isSendingToCanva) ? 'not-allowed' : 'pointer', opacity: (!canvaEditTarget || p.isSendingToCanva) ? 0.55 : 1, fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}
                      >
                        <div style={{ fontSize: 16 }}>🖼️</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginTop: 4 }}>{p.isSendingToCanva ? 'Opening…' : 'Edit Selected in Canva'}</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canvaEditTarget ? `✦ ${mediaFileName(canvaEditTarget)}` : 'Select an image in Recent Media'}</div>
                      </button>
                      <button
                        onClick={p.importFromCanva}
                        disabled={!p.canvaReadyId || p.isImportingFromCanva}
                        title={p.canvaReadyId ? 'Bring your edited design back as a new gallery item' : 'Finish editing in Canva first'}
                        style={{ textAlign: 'left', padding: 12, borderRadius: 12, border: `1px solid ${p.canvaReadyId ? C.primaryBorder : C.border}`, backgroundColor: p.canvaReadyId ? C.primarySoft : '#fff', cursor: (!p.canvaReadyId || p.isImportingFromCanva) ? 'not-allowed' : 'pointer', opacity: (!p.canvaReadyId || p.isImportingFromCanva) ? 0.6 : 1, fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(15,23,42,0.05)', gridColumn: '1 / -1' }}
                      >
                        <div style={{ fontSize: 16 }}>{p.isImportingFromCanva ? '⏳' : '📥'}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: p.canvaReadyId ? C.primaryDark : C.ink, marginTop: 4 }}>{p.isImportingFromCanva ? 'Importing…' : 'Import from Canva'}{p.canvaReadyId && !p.isImportingFromCanva ? ' ●' : ''}</div>
                        <div style={{ fontSize: 10, color: p.canvaReadyId ? C.primaryDark : C.muted, marginTop: 2, lineHeight: 1.5 }}>{p.canvaReadyId ? 'Your edited design is ready — bring it in' : 'Bring existing Canva designs into SocialPulse'}</div>
                      </button>
                    </div>
                  )}
                  {p.canvaConnected && (
                    <button onClick={p.disconnectCanva} style={{ marginTop: 10, fontSize: 10, fontWeight: 700, color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Disconnect Canva</button>
                  )}
                </div>
              </div>
            </div>

            {/* ---- Recent Media gallery ---- */}
            {/* Same items, same handlers (upload/generate/Canva/carousel all
                feed mediaItems) — this is a presentation layer over the
                existing gallery: select, filter, reorder, per-item menu. */}
            <div style={{ ...card, padding: 18, marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Recent Media</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Click a card to select it for Canva editing • drag cards to reorder • ★ marks the cover.</div>
                </div>
              </div>
              {(() => {
                const brandedCount = p.mediaItems.filter(m => p.burnedLogoIds[m.id]).length;
                const countFor = (f: string) => f === 'all' ? p.mediaItems.length : f === 'branded' ? brandedCount : p.mediaItems.filter(m => mediaSource(m) === f).length;
                const chips = [
                  { id: 'all', label: 'All' },
                  { id: 'ai', label: '✨ AI Generated' },
                  { id: 'upload', label: 'Uploaded' },
                  { id: 'canva', label: 'Canva' },
                  { id: 'branded', label: '🏷️ Branded' },
                ] as const;
                const items = p.mediaItems.filter(m =>
                  galleryFilter === 'all' ? true
                    : galleryFilter === 'branded' ? p.burnedLogoIds[m.id]
                      : mediaSource(m) === galleryFilter);
                return (
                  <div>
                    {openMenuId && <div onClick={() => { setOpenMenuId(null); setSlideMenu(null); }} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 12px' }}>
                      {chips.map(ch => (
                        <button key={ch.id} onClick={() => setGalleryFilter(ch.id)} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: galleryFilter === ch.id ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`, backgroundColor: galleryFilter === ch.id ? C.primarySoft : '#fff', color: galleryFilter === ch.id ? C.primaryDark : C.muted, cursor: 'pointer' }}>
                          {ch.label} <span style={{ opacity: 0.65 }}>· {countFor(ch.id)}</span>
                        </button>
                      ))}
                    </div>
                    {p.mediaItems.length === 0 ? (
                      <div style={{ border: '1.5px dashed #CBD5E1', borderRadius: 12, backgroundColor: '#FCFCFE', padding: 24, textAlign: 'center', color: C.faint, fontSize: 12 }}>No media yet — upload files or generate an AI image above.</div>
                    ) : items.length === 0 ? (
                      <div style={{ border: '1.5px dashed #CBD5E1', borderRadius: 12, backgroundColor: '#FCFCFE', padding: 24, textAlign: 'center', color: C.faint, fontSize: 12 }}>Nothing in this filter — try another one.</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                        {items.map(m => {
                          const idx = p.mediaItems.indexOf(m);
                          const src = SOURCE_META[mediaSource(m)];
                          const branded = !!p.burnedLogoIds[m.id];
                          const selected = selectedMediaId === m.id;
                          const inCarousel = p.carouselSlides.some(s => s.id === m.id);
                          return (
                            <div key={m.id} draggable
                              onClick={() => { setSelectedMediaId(m.id); setOpenMenuId(null); }}
                              onDragStart={() => p.handleMediaDragStart(m.id)}
                              onDragOver={e => p.handleMediaDragOver(e, m.id)}
                              onDrop={e => p.handleMediaDrop(e, m.id)}
                              onDragEnd={p.handleMediaDragEnd}
                              title="Select • drag to reorder"
                              style={{ position: 'relative', borderRadius: 14, overflow: 'visible', border: selected ? `2px solid ${C.primary}` : p.dragOverMediaId === m.id ? `2px solid ${C.primary}` : `1px solid ${C.border}`, backgroundColor: '#fff', cursor: 'grab', opacity: p.draggedMediaId === m.id ? 0.5 : 1, boxShadow: selected ? '0 3px 12px rgba(124,58,237,0.18)' : '0 1px 3px rgba(15,23,42,0.05)' }}>
                              <div style={{ position: 'relative', aspectRatio: '4/3', overflow: 'hidden', backgroundColor: '#000', borderRadius: '12px 12px 0 0' }}>
                                {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} muted /> : <img src={m.url} alt={m.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
                                <span style={{ position: 'absolute', top: 6, left: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                  <span style={{ fontSize: 9, fontWeight: 800, backgroundColor: src.bg, color: src.color, border: `1px solid ${src.border}`, padding: '2px 7px', borderRadius: 999 }}>{src.label}</span>
                                  {idx === 0 && <span style={{ fontSize: 9, fontWeight: 800, backgroundColor: 'rgba(15,23,42,0.78)', color: '#fff', padding: '2px 7px', borderRadius: 999 }}>★ Cover</span>}
                                </span>
                                {selected && (
                                  <span style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, boxShadow: '0 2px 8px rgba(124,58,237,0.4)' }}>✓</span>
                                )}
                                {branded && <span style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 9, fontWeight: 800, backgroundColor: 'rgba(245,158,11,0.92)', color: '#fff', padding: '2px 7px', borderRadius: 999 }}>🏷️ Branded</span>}
                                {inCarousel && <span style={{ position: 'absolute', bottom: 6, left: branded ? 78 : 6, fontSize: 9, fontWeight: 800, backgroundColor: 'rgba(124,58,237,0.92)', color: '#fff', padding: '2px 7px', borderRadius: 999 }}>🎠 Slide {p.carouselSlides.findIndex(s => s.id === m.id) + 1}</span>}
                                <button onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === m.id ? null : m.id); }} title="More actions" style={{ position: 'absolute', bottom: 6, right: 6, width: 26, height: 26, borderRadius: 8, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 800, lineHeight: 1 }}>⋯</button>
                              </div>
                              {openMenuId === m.id && (
                                <span onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 64, right: 8, width: 178, backgroundColor: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.18)', zIndex: 51, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 4 }}>
                                  <button onClick={() => { p.setMediaCover(m.id); setOpenMenuId(null); }} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.ink, background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>🖼️ Set as cover</button>
                                  {m.type === 'image' && <button onClick={() => { p.openInCanva(m.url); setOpenMenuId(null); }} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.ink, background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>🎨 Edit in Canva</button>}
                                  <button onClick={() => { p.setLogoTargetId(m.id); p.setLogoModalOpen(true); setOpenMenuId(null); }} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.ink, background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>🏷️ Apply logo here</button>
                                  {m.type === 'image' && <button onClick={() => { p.varyImageFromUrl(m.url); setOpenMenuId(null); }} disabled={!!p.varyingImageUrl || p.isGeneratingImage} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.ink, background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', opacity: (!!p.varyingImageUrl || p.isGeneratingImage) ? 0.5 : 1 }}>✨ Vary image</button>}
                                  {m.type === 'image' && p.isCarousel && !inCarousel && <button onClick={() => { p.toggleCarouselSlide(m.id); setOpenMenuId(null); }} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.ink, background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>🎠 Add to carousel</button>}
                                  <button onClick={() => { p.removeMediaItem(m.id); if (selectedMediaId === m.id) setSelectedMediaId(null); setOpenMenuId(null); }} style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#DC2626', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>🗑️ Remove</button>
                                </span>
                              )}
                              <div style={{ padding: '8px 10px' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mediaFileName(m)}</div>
                                <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>{m.type === 'video' ? 'Video' : 'Image'}<MediaDims url={m.url} type={m.type} /></div>
                              </div>
                            </div>
                          );
                        })}
                        <button onClick={() => p.fileInputRef.current?.click()} title="Upload more media" style={{ borderRadius: 14, border: '1.5px dashed #CBD5E1', backgroundColor: '#FCFCFE', minHeight: 150, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: C.primaryDark, fontFamily: 'inherit' }}>
                          <span style={{ fontSize: 22, fontWeight: 800 }}>＋</span>
                          <span style={{ fontSize: 11, fontWeight: 700 }}>Add More</span>
                          <span style={{ fontSize: 10, color: C.faint }}>{9 - p.mediaItems.length} slots left</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {/* ---- Carousel ---- */}
            {/* Same slide-order state (carouselSlideIds) — compact horizontal
                re-skin: drag-to-reorder, per-slide menu, Add Slide tile. */}
            <div style={{ ...card, padding: 18, marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Carousel</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Group 2–9 images into one swipeable post for LinkedIn, Facebook and Instagram.</div>
                </div>
                <span style={{ display: 'flex', backgroundColor: '#F1F3F9', borderRadius: 999, padding: 3, gap: 2 }}>
                  <button onClick={() => p.setIsCarousel(false)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: 'none', backgroundColor: !p.isCarousel ? '#fff' : 'transparent', color: !p.isCarousel ? C.ink : C.muted, cursor: 'pointer', boxShadow: !p.isCarousel ? '0 1px 3px rgba(15,23,42,0.12)' : 'none' }}>Single Post</button>
                  <button onClick={() => p.setIsCarousel(true)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: 'none', backgroundColor: p.isCarousel ? '#fff' : 'transparent', color: p.isCarousel ? C.primaryDark : C.muted, cursor: 'pointer', boxShadow: p.isCarousel ? '0 1px 3px rgba(15,23,42,0.12)' : 'none' }}>🎠 Carousel{p.isCarousel ? ` · ${p.carouselSlides.length}` : ''}</button>
                </span>
              </div>
              {!p.isCarousel ? (
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>One post, one hero visual — switch to Carousel to bundle slides into a swipeable album.</div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>Swipe order = numbered order. Image-only (videos can&apos;t join a carousel). Drag slides to reorder.</div>
                  {p.carouselSlides.length > 0 ? (
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 2px 8px' }}>
                      {p.carouselSlides.map((m, i) => (
                        <div key={m.id} draggable
                          onDragStart={() => setDragSlideId(m.id)}
                          onDragOver={e => { e.preventDefault(); if (dragSlideId && dragSlideId !== m.id) setDragOverSlideId(m.id); }}
                          onDrop={() => { if (dragSlideId) p.reorderCarouselSlide(dragSlideId, m.id); setDragSlideId(null); setDragOverSlideId(null); }}
                          onDragEnd={() => { setDragSlideId(null); setDragOverSlideId(null); }}
                          title="Drag to reorder"
                          style={{ flex: '0 0 112px', position: 'relative', opacity: dragSlideId === m.id ? 0.5 : 1 }}>
                          <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', backgroundColor: '#000', borderRadius: 12, border: dragOverSlideId === m.id ? `2px solid ${C.primary}` : `1px solid ${C.primaryBorder}`, cursor: 'grab' }}>
                            <img src={m.url} alt={m.altText || `Slide ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                            <span style={{ position: 'absolute', top: 5, left: 5, minWidth: 20, height: 20, borderRadius: 999, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, padding: '0 5px' }}>{i + 1}</span>
                            <button onClick={e => { e.stopPropagation(); if (slideMenu?.id === m.id) { setSlideMenu(null); } else { const r = e.currentTarget.getBoundingClientRect(); setSlideMenu({ id: m.id, x: Math.max(8, r.right - 176), y: Math.max(8, r.top - 104) }); } }} title="Slide options" style={{ position: 'absolute', bottom: 5, right: 5, width: 24, height: 24, borderRadius: 7, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>⋯</button>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setShowSlidePicker(v => !v)} title="Add slides from Recent Media" style={{ flex: '0 0 112px', aspectRatio: '1', borderRadius: 12, border: '1.5px dashed #CBD5E1', backgroundColor: '#FCFCFE', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: C.primaryDark, fontFamily: 'inherit' }}>
                        <span style={{ fontSize: 20, fontWeight: 800 }}>＋</span>
                        <span style={{ fontSize: 10, fontWeight: 700 }}>Add Slide</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ border: '1.5px dashed #CBD5E1', borderRadius: 12, backgroundColor: '#FCFCFE', padding: 18, textAlign: 'center', color: C.faint, fontSize: 12 }}>No slides yet — add images from Recent Media or generate slides with AI.</div>
                  )}
                  {(() => {
                    const pos = slideMenu;
                    const sm = pos && p.carouselSlides.find(s => s.id === pos.id);
                    if (!sm || !pos) return null;
                    return (
                      <>
                        <div onClick={() => setSlideMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
                        <span onClick={e => e.stopPropagation()} style={{ position: 'fixed', left: pos.x, top: pos.y, width: 168, backgroundColor: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.18)', zIndex: 61, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 4 }}>
                          <button onClick={() => { setLightboxItem({ url: sm.url, type: sm.type }); setSlideMenu(null); }} style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.ink, background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>🔍 Preview slide</button>
                          <button onClick={() => { p.removeCarouselSlide(sm.id); setSlideMenu(null); }} style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#DC2626', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>× Remove slide</button>
                        </span>
                      </>
                    );
                  })()}
                  {(showSlidePicker || p.carouselSlides.length === 0) && (() => {
                    const addable = p.mediaItems.filter(m => m.type === 'image' && !p.carouselSlides.some(s => s.id === m.id));
                    if (!addable.length) return <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Every gallery image is already a slide — upload more via Add Media.</div>;
                    return (
                      <div style={{ marginTop: 8, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: 10, backgroundColor: '#FCFCFE' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Tap to add as the next slide</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {addable.map(m => (
                            <button key={m.id} onClick={() => p.toggleCarouselSlide(m.id)} title={`Add “${mediaFileName(m)}”`} style={{ width: 52, height: 52, borderRadius: 8, overflow: 'hidden', border: `1.5px dashed ${C.primaryBorder}`, padding: 0, cursor: 'pointer', backgroundColor: '#000', position: 'relative' }}>
                              <img src={m.url} alt={m.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff', backgroundColor: 'rgba(124,58,237,0.35)' }}>+</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ marginTop: 10, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.ink }}>✨ AI slides</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#fff', border: `1px solid ${C.border}`, borderRadius: 999, padding: '2px 6px' }}>
                        <button onClick={() => p.setCarouselSlideCount(Math.max(2, p.carouselSlideCount - 1))} disabled={p.isGeneratingCarousel || p.isGeneratingImage} style={{ width: 24, height: 24, border: 'none', background: 'none', fontSize: 14, fontWeight: 800, color: C.primaryDark, cursor: 'pointer' }}>−</button>
                        <span style={{ fontSize: 12, fontWeight: 800, color: C.ink, minWidth: 20, textAlign: 'center' }}>{p.carouselSlideCount}</span>
                        <button onClick={() => p.setCarouselSlideCount(Math.min(9, p.carouselSlideCount + 1))} disabled={p.isGeneratingCarousel || p.isGeneratingImage} style={{ width: 24, height: 24, border: 'none', background: 'none', fontSize: 14, fontWeight: 800, color: C.primaryDark, cursor: 'pointer' }}>+</button>
                      </span>
                      <button
                        onClick={() => p.generateCarouselSlides(p.carouselSlideCount)}
                        disabled={p.isGeneratingCarousel || p.isGeneratingImage || !p.aspectRatio || p.mediaItems.length >= 9}
                        title={!p.aspectRatio ? 'Choose an aspect ratio in Settings first' : p.mediaItems.length >= 9 ? 'Gallery is full (max 9)' : 'Generate a full set of carousel slides from your topic'}
                        style={{ padding: '8px 16px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: 'none', background: (p.isGeneratingCarousel || p.isGeneratingImage || !p.aspectRatio || p.mediaItems.length >= 9) ? '#DDD6FE' : 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: (p.isGeneratingCarousel || p.isGeneratingImage || !p.aspectRatio || p.mediaItems.length >= 9) ? 'not-allowed' : 'pointer' }}
                      >
                        {p.isGeneratingCarousel ? 'Generating slides…' : p.isGeneratingImage ? 'Generating…' : `Generate ${p.carouselSlideCount} slides`}
                      </button>
                    </div>
                    {!p.aspectRatio && <div style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>Choose an aspect ratio in Settings first — slides generate at that size.</div>}
                  </div>
                  {!p.carouselValidation.valid && (
                    <div style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '7px 10px', borderRadius: 8 }}>⚠️ {p.carouselValidation.reason} Instagram carousels additionally need publicly hosted image URLs.</div>
                  )}
                </div>
              )}
            </div>
            <input ref={p.fileInputRef} type="file" accept="image/*,video/*" multiple onChange={p.handleUploadImage} style={{ display: 'none' }} />

            {/* ---- Branding ---- */}
            {/* Same logo flow (modal upload → ffmpeg burn via
                applyLogoToAllMedia) — re-skinned into three compact cards.
                Colors/fonts are workspace-level visual selections. */}
            <div style={{ ...card, padding: 18, marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Branding</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Identity applied across every visual before publishing.</div>
                </div>
                <button
                  onClick={() => p.applyLogoToAllMedia()}
                  disabled={p.isApplyingLogo || !p.logoImage}
                  title={!p.logoImage ? 'Upload a brand logo first' : 'Burn the logo into all gallery media'}
                  style={{ ...primaryBtn(p.isApplyingLogo || !p.logoImage), width: 'auto', minHeight: 38, fontSize: 12 }}
                >
                  {p.isApplyingLogo ? 'Applying…' : 'Apply to All Slides'}
                </button>
              </div>
              <div className="sp-wiz-grid3">
                {/* Brand Logo */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Logo</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {p.logoImage
                      ? <img src={p.logoImage} alt="Brand logo" style={{ width: 44, height: 44, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 10, border: `1px solid ${C.border}`, padding: 4 }} />
                      : <span style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15 }}>SP</span>}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>SocialPulse</div>
                      <div style={{ fontSize: 10, color: p.logoImage ? '#059669' : C.faint, fontWeight: 600 }}>{p.logoImage ? `✓ Logo set • ${p.logoPosition} • ${Math.round(p.logoScale * 100)}%` : 'No logo yet'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                    <button onClick={() => p.setLogoModalOpen(true)} style={{ flex: 1, padding: '8px 10px', borderRadius: 9, fontSize: 11, fontWeight: 700, border: `1px solid ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer' }}>{p.logoImage ? 'Change' : 'Upload'}</button>
                    {p.logoImage && <button onClick={p.clearLogo} title="Remove the brand logo" style={{ flex: 1, padding: '8px 10px', borderRadius: 9, fontSize: 11, fontWeight: 700, border: '1px solid #FECACA', backgroundColor: '#fff', color: '#DC2626', cursor: 'pointer' }}>Remove</button>}
                  </div>
                </div>
                {/* Brand Colors */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Colors</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {brandSwatches.map(c => (
                      <button key={c} onClick={() => setActiveSwatch(c)} title={c} style={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: c, border: activeSwatch === c ? `2.5px solid ${C.primary}` : '1px solid rgba(15,23,42,0.15)', cursor: 'pointer', boxShadow: activeSwatch === c ? '0 0 0 3px #EDE9FE' : 'none', padding: 0 }} />
                    ))}
                    {brandSwatches.length < BRAND_SWATCHES.length + EXTRA_SWATCHES.length && (
                      <button onClick={() => { const next = EXTRA_SWATCHES.find(c => !brandSwatches.includes(c)); if (next) { setBrandSwatches(prev => [...prev, next]); setActiveSwatch(next); } }} title="Add a brand color" style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px dashed #CBD5E1', backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer', fontSize: 15, fontWeight: 800, lineHeight: 1 }}>+</button>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 'auto' }}>Active accent • {activeSwatch}</div>
                </div>
                {/* Brand Fonts */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Fonts</div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, fontWeight: 700, color: C.muted }}>
                    Heading Font
                    <select value={headingFont} onChange={e => setHeadingFont(e.target.value)} style={{ padding: '8px 10px', borderRadius: 9, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                      {['Poppins', 'Inter', 'Montserrat'].map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, fontWeight: 700, color: C.muted }}>
                    Body Font
                    <select value={bodyFont} onChange={e => setBodyFont(e.target.value)} style={{ padding: '8px 10px', borderRadius: 9, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                      {['Inter', 'Poppins', 'Roboto'].map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              {/* Preserved logo flow details: position readout, single-target
                  note, adjust dialog entry (position/size change in dialog). */}
              {p.logoImage && <div style={{ fontSize: 10, color: C.faint, marginTop: 10 }}>Logo position: {p.logoPosition} • size {Math.round(p.logoScale * 100)}% — change position/size in the logo dialog.</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {p.logoImage && (
                  <button onClick={() => { p.setLogoTargetId(null); p.setLogoModalOpen(true); }} style={{ ...ghostBtn, minHeight: 38, fontSize: 12, flex: 1 }}>🏷️ Adjust Logo</button>
                )}
              </div>
              {p.logoTargetId && p.mediaItems.some(m => m.id === p.logoTargetId) && (
                <div style={{ marginTop: 8, fontSize: 11, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '7px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1 }}>🎯 Will apply to {(() => { const i = p.mediaItems.findIndex(m => m.id === p.logoTargetId); return i === 0 ? '★ Cover image' : `Image #${i + 1}`; })()} only</span>
                  <button onClick={() => p.setLogoTargetId(null)} style={{ fontSize: 10, fontWeight: 700, background: 'none', border: 'none', color: C.primaryDark, cursor: 'pointer', textDecoration: 'underline' }}>All instead</button>
                </div>
              )}
            </div>

            {altTextControls}
            <WizardNav
              onBack={goBack}
              backLabel="← Back"
              next={<span style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setCurrentStep(5)} style={{ ...ghostBtn, width: 'auto' }}>Preview</button>
                <button onClick={goNext} style={primaryBtn(false)}>Next →</button>
              </span>}
            />
          </div>
        )}

        {/* ================= STEP 5 — PREVIEW ================= */}
        {[5, 6].includes(currentStep) && altTextControls}
        {currentStep === 5 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Preview Your Post</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Step 5 of 6: See how your content will look before publishing</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {([...p.selectedPlatforms].length ? p.selectedPlatforms : ['linkedin']).map(pl => (
                  <button key={pl} onClick={() => { setPreviewPlatform(pl); if (p.platformContent[pl]) p.switchPreviewPlatform(pl); }} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'capitalize', border: previewPlatform === pl ? `1.5px solid ${p.platformColors[pl] || '#0A66C2'}` : `1px solid ${C.border}`, backgroundColor: previewPlatform === pl ? '#EFF6FF' : '#fff', color: previewPlatform === pl ? (p.platformColors[pl] || '#0A66C2') : C.muted, cursor: 'pointer' }}>{pl}</button>
                ))}
              </div>
            </div>
            <div className="sp-wiz-prev">
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' }}>
                <div style={{ padding: '12px 14px', display: 'flex', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: p.logoImage ? `url(${p.logoImage}) center/cover` : 'linear-gradient(135deg,#0A66C2,#004182)', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, overflow: 'hidden', flexShrink: 0 }}>{!p.logoImage && 'SP'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>SocialPulse <span style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>• 1st</span></div>
                    <div style={{ fontSize: 11, color: C.muted }}>Just now • 🌐 Public</div>
                  </div>
                  <span style={{ color: C.faint }}>⋯</span>
                </div>
                <div style={{ padding: '0 14px 4px', fontSize: 13, lineHeight: 1.65, color: C.ink, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'hidden' }}>
                  {(() => {
                    if (!p.content.trim()) return 'Your amazing post will appear here...\nThis is how it will look on LinkedIn.';
                    // Caption already carries appended hashtags — strip the trailing tag block for display
                    // (tags render separately below in LinkedIn blue, exactly as published)
                    const tags = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
                    if (!tags.length) return p.content;
                    return p.content.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim() || p.content;
                  })()}
                </div>
                {(p.platformContent[p.activePreviewPlatform]?.hashtags || []).length > 0 && (
                  <div style={{ padding: '0 14px 12px', fontSize: 13, lineHeight: 1.7, color: '#0A66C2', fontWeight: 600 }}>
                    {(p.platformContent[p.activePreviewPlatform]?.hashtags || []).map(t => '#' + String(t).replace(/^#+/, '')).join(' ')}
                  </div>
                )}
                {(p.mediaItems.length > 0 || postExtraImages.length > 0 || p.generatedImage || p.generatedVideo) ? (
                  <div style={{ backgroundColor: '#000' }}>
                    {(() => {
                      // Carousel swipe preview: one slide at a time with
                      // arrows + dots + counter, mirroring the real
                      // swipeable album on every platform.
                      if (p.isCarousel && p.carouselSlides.length > 0) {
                        const slides = p.carouselSlides.slice(0, 9);
                        const idx = Math.min(carouselPreviewIndex, slides.length - 1);
                        const it = slides[idx];
                        const go = (d: -1 | 1) => setCarouselPreviewIndex((idx + d + slides.length) % slides.length);
                        return (
                          <div>
                            <div style={{ position: 'relative', aspectRatio: '4/3', overflow: 'hidden', backgroundColor: '#000' }}>
                              {it.type === 'video' ? <video src={it.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={it.url} alt={it.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                              {slides.length > 1 && (
                                <>
                                  <button onClick={() => go(-1)} title="Previous slide" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                                  <button onClick={() => go(1)} title="Next slide" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                                </>
                              )}
                              <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 800, backgroundColor: 'rgba(124,58,237,0.92)', color: '#fff', padding: '3px 9px', borderRadius: 999 }}>🎠 {idx + 1}/{slides.length}</span>
                              <button onClick={e => { e.stopPropagation(); setLightboxItem({ url: it.url, type: it.type }); }} title="View full, uncropped" style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🔍</button>
                              {it.type === 'image' && !!it.url && (
                                <button onClick={e => { e.stopPropagation(); p.varyImageFromUrl(it.url); }} disabled={!!p.varyingImageUrl || p.isGeneratingImage} title="Generate an AI variation of this slide (added as a new item)" style={{ position: 'absolute', bottom: 8, right: 8, padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', background: 'rgba(124,58,237,0.92)', color: '#fff', cursor: (!!p.varyingImageUrl || p.isGeneratingImage) ? 'wait' : 'pointer' }}>
                                  {p.varyingImageUrl === it.url ? 'Varying…' : '✨ Vary'}
                                </button>
                              )}
                              {p.logoImage && !p.burnedLogoIds[it.id] && (
                                <img src={p.logoImage} alt="logo" style={{
                                  position: 'absolute', width: `${Math.round(p.logoScale * 100)}%`, maxWidth: '28%', opacity: p.logoOpacity,
                                  ...(p.logoPosition === 'top-left' ? { top: 8, left: 8 } : p.logoPosition === 'top-right' ? { top: 8, right: 8 } : p.logoPosition === 'bottom-left' ? { bottom: 8, left: 8 } : p.logoPosition === 'bottom-right' ? { bottom: 8, right: 8 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                                  backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6,
                                }} />
                              )}
                            </div>
                            {slides.length > 1 && (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', backgroundColor: '#000' }}>
                                {slides.map((s, i) => (
                                  <button key={s.id} onClick={() => setCarouselPreviewIndex(i)} title={`Slide ${i + 1}`} style={{ width: i === idx ? 18 : 7, height: 7, borderRadius: 999, border: 'none', backgroundColor: i === idx ? '#8B5CF6' : 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0, transition: 'all 0.18s' }} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                      const items = previewItems;
                      const single = items.length === 1;
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: single ? '1fr' : '1fr 1fr', gap: 2 }}>
                          {items.map(it => (
                            <div key={it.id} style={{ position: 'relative', aspectRatio: single ? '16/9' : '1', overflow: 'hidden', backgroundColor: '#000', cursor: 'zoom-in' }} onClick={() => setLightboxItem({ url: it.url, type: it.type })}>
                              {it.type === 'video' ? <video src={it.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={it.url} alt={it.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                              <button onClick={e => { e.stopPropagation(); setLightboxItem({ url: it.url, type: it.type }); }} title="View full, uncropped" style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(15,23,42,0.65)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🔍</button>
                              {it.type === 'image' && !!it.url && (
                                <button onClick={e => { e.stopPropagation(); p.varyImageFromUrl(it.url); }} disabled={!!p.varyingImageUrl || p.isGeneratingImage} title="Generate an AI variation of this image (added as a new item)" style={{ position: 'absolute', bottom: 8, right: 8, padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', background: 'rgba(124,58,237,0.92)', color: '#fff', cursor: (!!p.varyingImageUrl || p.isGeneratingImage) ? 'wait' : 'pointer' }}>
                                  {p.varyingImageUrl === it.url ? 'Varying…' : '✨ Vary'}
                                </button>
                              )}
                              {p.logoImage && !p.burnedLogoIds[it.id] && (
                                <img src={p.logoImage} alt="logo" style={{
                                  position: 'absolute', width: `${Math.round(p.logoScale * 100)}%`, maxWidth: '28%', opacity: p.logoOpacity,
                                  ...(p.logoPosition === 'top-left' ? { top: 8, left: 8 } : p.logoPosition === 'top-right' ? { top: 8, right: 8 } : p.logoPosition === 'bottom-left' ? { bottom: 8, left: 8 } : p.logoPosition === 'bottom-right' ? { bottom: 8, right: 8 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                                  backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6,
                                }} />
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div style={{ margin: '0 14px 12px', border: '1.5px dashed #CBD5E1', borderRadius: 10, backgroundColor: '#F8FAFC', padding: 28, textAlign: 'center', color: C.faint, fontSize: 12 }}>🖼️ No image yet — add media in Step 4</div>
                )}
                <div style={{ padding: '10px 14px', display: 'flex', gap: 18, borderTop: `1px solid ${C.borderSoft}`, fontSize: 11, color: C.muted, fontWeight: 600 }}>
                  <span>👍 Like</span><span>💬 Comment</span><span>↗️ Repost</span><span style={{ marginLeft: 'auto' }}>✈️ Send</span>
                </div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, backgroundColor: '#F8FAFC' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 12 }}>Final Review</div>
                {[
                  ['Topic', p.prompt ? (p.prompt.length > 60 ? p.prompt.slice(0, 60) + '…' : p.prompt) : '—'],
                  ['Tone', p.tone],
                  ['Image Style', p.imageStyle],
                  ['Aspect Ratio', p.aspectRatio || '—'],
                  ['Media Count', `${previewMediaCount} file${previewMediaCount === 1 ? '' : 's'}`],
                  ['Branding', p.logoImage ? `Logo • ${p.logoPosition}` : 'No logo'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.borderSoft}`, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <span style={{ color: C.ink, fontWeight: 600, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <WizardNav onBack={goBack} next={<span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCancelPreview(true)} style={{ ...ghostBtn, color: '#B91C1C' }}>Cancel</button>
              <button onClick={goNext} style={primaryBtn(false)}>Continue to Publish →</button>
            </span>} />
          </div>
        )}

        {/* ================= STEP 6 — PUBLISH ================= */}
        {currentStep === 6 && (
          <div>
            {header('Publish Your Post', 'Step 6 of 6: Share now or schedule for later', 'Great content is meant to be shared! Choose your platform and timing.')}
            <div className="sp-wiz-grid2" style={{ alignItems: 'start' }}>
              <div>
                <SectionTitle>Publishing Platforms</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {['linkedin', 'instagram', 'facebook', 'whatsapp'].map(pl => {
                    const label = pl === 'whatsapp' ? 'WhatsApp' : pl.charAt(0).toUpperCase() + pl.slice(1);
                    const isWhapi = pl === 'whatsapp';
                    const comingSoon = false;
                    const standbyLabel = '';
                    const selected = p.selectedPlatforms.includes(pl);
                    const connected = isWhapi ? p.whapiConnected : p.accounts.some(a => a.platform === pl && a.connected);
                    return (
                      <button key={pl} onClick={() => { if (!comingSoon) p.togglePlatform(pl); }} disabled={comingSoon}
                        style={{ padding: 10, borderRadius: 10, border: selected && !comingSoon ? `1.5px solid ${p.platformColors[pl] || C.primary}` : `1px solid ${C.border}`, backgroundColor: comingSoon ? '#F8FAFC' : '#fff', opacity: comingSoon ? 0.65 : 1, cursor: comingSoon ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
                        <span style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: p.platformColors[pl], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <p.PlatformIcon platform={pl} size={13} />
                        </span>
                        <span>
                          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.ink }}>{label}</span>
                          <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: comingSoon ? '#B45309' : connected ? '#059669' : C.faint }}>{comingSoon ? standbyLabel : connected ? '● Connected' : '○ Not connected'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <SectionTitle>Connected Accounts</SectionTitle>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(['linkedin', 'facebook', 'instagram'] as const).map(pl => {
                    const acc = p.accounts.find(a => a.platform === pl && a.connected);
                    const label = pl.charAt(0).toUpperCase() + pl.slice(1);
                    if (!acc) return (
                      <div key={pl} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, textAlign: 'center', backgroundColor: '#FCFCFE' }}>
                        <div style={{ fontSize: 11, color: C.muted }}>{pl === 'instagram' ? 'Connect a Business or Creator account linked to your Facebook Page.' : `No ${label} account connected yet`}</div>
                        <button onClick={() => p.connectPlatform(pl)} style={{ marginTop: 8, padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer' }}>Connect {label}</button>
                      </div>
                    );
                    return (
                      <div key={pl} style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 10, backgroundColor: '#F8FAFC' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: p.platformColors[pl], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <p.PlatformIcon platform={pl} size={14} />
                          </span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink }}>{acc.name || 'Admin / SocialPulse'}</span>
                            <span style={{ display: 'block', fontSize: 10, color: '#059669', fontWeight: 600 }}>● Connected{acc.email ? ` • ${acc.email}` : ''}{pl === 'facebook' && acc.pages?.length ? ` • ${(acc.pages.find(pg => pg.id === acc.pageId) || acc.pages[0]).name}` : ''}</span>
                          </span>
                          <button onClick={() => p.disconnectPlatform(pl)} style={{ fontSize: 10, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, padding: '5px 9px', cursor: 'pointer' }}>{pl === 'instagram' ? 'Deselect' : 'Disconnect'}</button>
                        </div>
                        {pl === 'facebook' && (acc.pages?.length || 0) > 1 && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, fontWeight: 600, color: C.muted }}>
                            Page
                            <select
                              value={acc.pageId || acc.pages![0].id}
                              onChange={e => p.setAccountPageId('facebook', e.target.value)}
                              style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                            >
                              {acc.pages!.map(pg => (
                                <option key={pg.id} value={pg.id}>{pg.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ---- WhatsApp — SocialPulse-managed connection ---- */}
                <div style={{ marginTop: 16, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, backgroundColor: p.whapiConnected ? '#F0FDF4' : '#FFFBEB' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: p.whapiConnected ? 10 : 0 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: p.whapiConnected ? '#25D366' : '#E2E8F0', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💬</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>WhatsApp</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: p.whapiConnected ? '#059669' : '#92400E' }}>
                        {p.whapiLoading ? 'Checking…' : p.whapiConnected ? `● Connected${p.whapiAccountName ? ` • ${p.whapiAccountName}` : ''}${p.whapiPhoneMasked ? ` • ${p.whapiPhoneMasked}` : ''}` : '○ Not connected'}
                      </div>
                    </div>
                    {!p.whapiConnected && (
                      <button onClick={() => p.startWhatsAppConnect()} disabled={p.whapiLoading} style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, cursor: 'pointer' }}>Connect WhatsApp</button>
                    )}
                    {p.whapiConnected && (
                      <button onClick={() => p.disconnectWhatsApp()} disabled={p.whatsappDisconnecting || p.whapiLoading} title="Disconnect WhatsApp" style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#DC2626', cursor: (p.whatsappDisconnecting || p.whapiLoading) ? 'wait' : 'pointer', opacity: (p.whatsappDisconnecting || p.whapiLoading) ? 0.6 : 1 }}>{p.whatsappDisconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
                    )}
                  </div>

                  {p.whapiConnected ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Destination: <span style={{ fontWeight: 600, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '1px 7px', borderRadius: 999 }}>WhatsApp</span></div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, minWidth: 78 }}>Chat:</label>
                        <select
                          value={p.whapiSelectedGroupId}
                          onChange={e => p.setWhapiSelectedGroupId(e.target.value)}
                          onFocus={() => { if (!p.whapiGroups.length && !p.whapiGroupsLoading) p.loadWhapiGroups(); }}
                          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                        >
                          {p.whapiGroups.length === 0 && <option value="">{p.whapiGroupsLoading ? 'Loading chats…' : p.whapiGroupsError ? `Error: ${p.whapiGroupsError}` : 'Select chat'}</option>}
                          {(() => {
                            const renderOption = (g: { id: string; name: string; participantsCount?: number; type: string }) => {
                              const isUnsSendable = g.type === 'community' || (g.participantsCount !== undefined && g.participantsCount < 2);
                              return (
                                <option key={g.id} value={g.id} disabled={isUnsSendable}>{g.name} {g.participantsCount ? `• ${g.participantsCount}` : ''}{g.type !== 'group' ? ` • ${g.type}` : ''}{isUnsSendable ? ' • not sendable' : ''}</option>
                              );
                            };
                            const communities = p.whapiGroups.filter(g => (g as { source?: string }).source === 'community' || g.type === 'announcement_group');
                            const groups = p.whapiGroups.filter(g => !((g as { source?: string }).source === 'community' || g.type === 'announcement_group'));
                            // Fallback for entries without a source tag (back-compat): split by type.
                            const hasSource = p.whapiGroups.some(g => (g as { source?: string }).source);
                            if (!hasSource) return p.whapiGroups.map(renderOption);
                            return (
                              <>
                                {communities.length > 0 && <optgroup label={`Communities (${communities.length})`}>{communities.map(renderOption)}</optgroup>}
                                {groups.length > 0 && <optgroup label={`All groups (${groups.length})`}>{groups.map(renderOption)}</optgroup>}
                              </>
                            );
                          })()}
                        </select>
                        <button onClick={() => p.loadWhapiGroups()} disabled={p.whapiGroupsLoading} title="Refresh WhatsApp chats" style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: p.whapiGroupsLoading ? '#94A3B8' : C.ink, cursor: p.whapiGroupsLoading ? 'wait' : 'pointer' }}>{p.whapiGroupsLoading ? '…' : '↻'}</button>
                      </div>

                      {p.whapiGroups.length === 0 && !p.whapiGroupsLoading && !p.whapiGroupsError && (
                        <button onClick={() => p.loadWhapiGroups()} style={{ width: '100%', padding: 9, borderRadius: 9, fontSize: 12, fontWeight: 600, border: `1px dashed ${C.border}`, backgroundColor: '#fff', color: C.muted, cursor: 'pointer', marginBottom: 8 }}>Load WhatsApp chats</button>
                      )}
                      {p.whapiGroupsError && <div style={{ fontSize: 11, color: '#DC2626', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '6px 8px', borderRadius: 8, marginBottom: 8 }}>⚠️ {p.whapiGroupsError}</div>}

                      <div style={{ fontSize: 11, color: '#065F46', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '7px 10px', borderRadius: 8, marginBottom: 10 }}>
                        Status: WhatsApp Connected {p.whapiSelectedGroupId ? `• ${p.whapiGroups.find(g => g.id === p.whapiSelectedGroupId)?.name || 'Selected chat'}` : '• No chat selected'}
                      </div>

                      {(() => {
                        const sel = p.whapiGroups.find(g => g.id === p.whapiSelectedGroupId);
                        const unsendable = sel ? (sel.type === 'community' || (sel.participantsCount ?? 0) < 2) : false;
                        return (
                          <>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => p.publishToWhapi()}
                                disabled={p.whapiPublishing || p.isPublishing || p.publishCooldown > 0 || !p.whapiSelectedGroupId || unsendable || (!p.content.trim() && p.mediaItems.length === 0 && !p.generatedImage)}
                                title={unsendable ? 'This chat cannot receive messages directly' : !p.whapiSelectedGroupId ? 'Select a chat first' : !p.content.trim() && p.mediaItems.length === 0 && !p.generatedImage ? 'Add content or media first' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : 'Publish to WhatsApp'}
                                style={{ flex: 1, minHeight: 38, padding: '9px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: 'none', background: (p.whapiPublishing || p.isPublishing || p.publishCooldown > 0 || !p.whapiSelectedGroupId || unsendable || (!p.content.trim() && p.mediaItems.length === 0 && !p.generatedImage)) ? '#DDD6FE' : 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff', cursor: (p.whapiPublishing || p.isPublishing || p.publishCooldown > 0 || !p.whapiSelectedGroupId || unsendable) ? 'not-allowed' : 'pointer', boxShadow: (p.whapiPublishing || p.isPublishing) ? 'none' : '0 3px 12px rgba(37,211,102,0.3)' }}
                              >
                                {p.whapiPublishing ? 'Sending…' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : '📨 Publish to WhatsApp'}
                              </button>
                            </div>
                            <div style={{ fontSize: 10, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>One click = one message. No hidden retries.</div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#92400E', lineHeight: 1.6 }}>
                      Connect your WhatsApp account to publish directly from SocialPulse.
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 16 }}>
                  <SectionTitle>Publishing Options</SectionTitle>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {([['now', 'Publish Now', 'Share immediately'], ['later', 'Schedule for Later', 'Pick a date and time']] as const).map(([k, t, s]) => (
                      <button key={k} onClick={() => setPublishMode(k)} style={{ padding: 12, borderRadius: 10, border: publishMode === k ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`, backgroundColor: publishMode === k ? C.primarySoft : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', border: publishMode === k ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: publishMode === k ? C.primary : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>{publishMode === k ? '●' : ''}</span>
                        <span><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: publishMode === k ? C.primaryDark : C.ink }}>{t}</span><span style={{ display: 'block', fontSize: 10, color: C.muted }}>{s}</span></span>
                      </button>
                    ))}
                  </div>
                  {publishMode === 'later' && (
                    <button onClick={() => p.setScheduleModalOpen(true)} style={{ marginTop: 8, width: '100%', padding: 11, borderRadius: 10, border: `1.5px dashed ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📅 Pick a date & time (5+ min ahead)</button>
                  )}
                </div>
              </div>
              <div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, backgroundColor: '#F8FAFC' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>Ready to Go</div>
                  <div style={{ fontSize: 12, color: C.ink, backgroundColor: '#fff', border: `1px solid ${C.borderSoft}`, borderRadius: 8, padding: 10, maxHeight: 90, overflow: 'hidden' }}>
                    {(p.content.split('\n')[0] || 'No caption yet').slice(0, 140)}
                  </div>
                  {((p.isCarousel ? p.carouselSlides : p.mediaItems).length > 0) && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {(p.isCarousel ? p.carouselSlides : p.mediaItems).slice(0, 4).map(m => (
                        <span key={m.id} style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}`, backgroundColor: '#000', display: 'block' }}>
                          {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={m.url} alt={m.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </span>
                      ))}
                      {(p.isCarousel ? p.carouselSlides : p.mediaItems).length > 4 && <span style={{ fontSize: 11, color: C.muted, alignSelf: 'center' }}>+{(p.isCarousel ? p.carouselSlides : p.mediaItems).length - 4}</span>}
                    </div>
                  )}
                  {p.isCarousel && (
                    <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, padding: '7px 10px', borderRadius: 8, border: `1px solid ${p.carouselValidation.valid ? '#A7F3D0' : '#FDE68A'}`, backgroundColor: p.carouselValidation.valid ? '#ECFDF5' : '#FFFBEB', color: p.carouselValidation.valid ? '#065F46' : '#92400E' }}>
                      {p.carouselValidation.valid ? `🎠 Carousel: ${p.carouselSlides.length} slides ✓ ready — publishes as one swipeable post` : `🎠 Carousel: ${p.carouselValidation.reason}`}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Platforms: <b style={{ color: C.ink }}>{p.selectedPlatforms.length ? p.selectedPlatforms.map(pl => `${pl.charAt(0).toUpperCase() + pl.slice(1)} ${(pl === 'whatsapp' ? p.whapiConnected : p.accounts.some(a => a.platform === pl && a.connected)) ? '● Connected' : '○ Not connected'}`).join(' • ') : '—'}</b></div>
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 9, fontSize: 11, fontWeight: 600,
                    backgroundColor: canPublish ? '#ECFDF5' : '#FFFBEB',
                    border: `1px solid ${canPublish ? '#A7F3D0' : '#FDE68A'}`,
                    color: canPublish ? '#065F46' : '#92400E' }}>
                    {canPublish ? '✓ All required fields completed.' : '⚠ Missing: ' + [
                      !hasContent ? 'content' : null,
                      p.selectedPlatforms.length === 0 ? 'platform selection' : (connectedSelected.length === 0 ? 'connection for the selected platform' : null),
                    ].filter(Boolean).join(' • ')}
                  </div>
                </div>
              </div>
            </div>
            <WizardNav
              onBack={goBack}
              next={<span style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveDraft} style={{ ...ghostBtn, width: 'auto' }}>💾 Save Draft</button>
                {publishMode === 'now' ? (
                  <button onClick={p.publishToAll} disabled={p.isPublishing || p.publishCooldown > 0 || !canPublish} title={!canPublish ? publishBlocker : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s before publishing again` : 'Publish now'}
                    style={{ ...primaryBtn(p.isPublishing || p.publishCooldown > 0 || !canPublish), width: 'auto', background: (p.isPublishing || p.publishCooldown > 0 || !canPublish) ? '#DDD6FE' : 'linear-gradient(135deg,#059669,#10B981)', boxShadow: '0 4px 14px rgba(5,150,105,0.3)' }}>
                    {p.isPublishing ? 'Publishing…' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : '🚀 Publish Now →'}
                  </button>
                ) : (
                  <button onClick={() => p.setScheduleModalOpen(true)} disabled={!canPublish} style={primaryBtn(!canPublish)}>📅 Schedule Post →</button>
                )}
              </span>}
            />
          </div>
        )}
      </div>

      {showCancelPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(15,23,42,0.46)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-preview-title" style={{ width: 'min(420px, 100%)', backgroundColor: '#fff', borderRadius: 8, padding: 22, boxShadow: '0 20px 60px rgba(15,23,42,0.22)' }}>
            <h3 id="cancel-preview-title" style={{ margin: '0 0 8px', fontSize: 16, color: C.ink }}>Cancel this post?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, lineHeight: 1.6, color: C.muted }}>Your content and media will be saved to Drafts. Nothing will be published.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setShowCancelPreview(false)} disabled={isCancellingPreview} style={ghostBtn}>Keep editing</button>
              <button onClick={async () => {
                if (isCancellingPreview) return;
                setIsCancellingPreview(true);
                try { if (await p.cancelPreview()) setShowCancelPreview(false); }
                finally { setIsCancellingPreview(false); }
              }} disabled={isCancellingPreview} style={{ ...primaryBtn(isCancellingPreview), background: isCancellingPreview ? '#FCA5A5' : '#DC2626', boxShadow: 'none' }}>{isCancellingPreview ? 'Saving…' : 'Cancel Post'}</button>
            </div>
          </div>
        </div>
      )}

      {lightboxItem && (
        <div onClick={() => setLightboxItem(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'zoom-out' }}>
          <button onClick={() => setLightboxItem(null)} title="Close" style={{ position: 'absolute', top: 20, right: 24, width: 36, height: 36, borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 18, cursor: 'pointer' }}>✕</button>
          {lightboxItem.type === 'video' ? (
            <video src={lightboxItem.url} controls autoPlay onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
          ) : (
            <img src={lightboxItem.url} alt={lightboxItem.altText || 'Full preview'} onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
          )}
        </div>
      )}
    </div>
  );
}
