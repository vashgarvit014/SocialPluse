'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { StudioWorkspaceProps } from './studio-workspace';
import type { MediaItem } from './social-media-manager';
import AiImageLoader from './ai-image-loader';
import InstagramPhonePreview from './instagram-preview';
import FacebookPostPreview from './facebook-preview';
import LinkedInPostPreview from './linkedin-preview';
import WhatsAppCommunityPreview from './whatsapp-preview';
import WhatsAppDestinationPicker from './whatsapp-destination-picker';

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

// Premium selectable option card (Step 2) — vertical layout with description
// and corner check indicator. Behavior identical to selectCard.
const selectCardPremium = (active: boolean): React.CSSProperties => ({
  position: 'relative', padding: '16px 14px 14px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit',
  border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`,
  background: active ? 'linear-gradient(180deg,#F6F1FF,#EDE9FE)' : '#fff',
  boxShadow: active ? '0 6px 20px rgba(124,58,237,0.18)' : '0 1px 2px rgba(15,23,42,0.04)',
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, textAlign: 'left', width: '100%',
  boxSizing: 'border-box',
});

const checkBadge = (active: boolean): React.CSSProperties => ({
  position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: '50%',
  border: active ? `2px solid ${C.primary}` : `1.5px solid #CBD5E1`,
  backgroundColor: active ? C.primary : '#fff', color: '#fff', fontSize: 11, fontWeight: 800,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
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
// Canonical display names for the platform ids already used by
// selectedPlatforms. Shared by the platform rows and the "Selected for content"
// summary so a label can never drift between them (deriving it with
// charAt(0).toUpperCase() rendered "Linkedin" / "Whatsapp").
const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
};

// Stepper
// ---------------------------------------------------------------------------
const STEPS = [
  { n: 1, t: 'Idea' },
  { n: 2, t: 'Settings' },
  { n: 3, t: 'Content' },
  { n: 4, t: 'Media' },
  { n: 5, t: 'Design' },
  { n: 6, t: 'Branding' },
  { n: 7, t: 'Preview' },
  { n: 8, t: 'Publish' },
];

function WizardStepper({ step, go }: { step: number; go: (n: number) => void }) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < max - 4);
  }, []);

  const reducedMotion = () =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const centerActive = useCallback((instant: boolean) => {
    // Deterministic scroll math instead of scrollIntoView(): the latter is
    // affected by CSS scroll-behavior hijacking ('auto' becomes smooth on this
    // rail), by layout timing, and by clamp edge cases — observed as a fixed
    // ~145px miss at 768px that no amount of deferral fixed. An explicit
    // scrollTo target computed from live rects always wins over CSS, and the
    // browser clamps it correctly at the content edges (where perfect
    // centering is physically impossible).
    const el = railRef.current;
    const item = activeRef.current;
    if (!el || !item) return;
    const railBox = el.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const target = el.scrollLeft
      + (itemBox.left + itemBox.width / 2)
      - (railBox.left + railBox.width / 2);
    el.scrollTo({ left: target, behavior: instant || reducedMotion() ? 'instant' : 'smooth' });
  }, []);

  // scrollIntoView measures layout synchronously, so calling it in the same
  // task as a viewport resize (or a React commit that is still reflowing) can
  // center against stale geometry and leave the rail overscrolled. Deferring
  // past layout settles it. The id is kept so rapid resizes coalesce.
  const rafRef = useRef<number | null>(null);
  const scheduleCenter = useCallback((instant: boolean) => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        centerActive(instant);
      });
    });
  }, [centerActive]);

  useEffect(() => {
    updateArrows();
    const el = railRef.current;
    if (!el) return;
    const onScroll = () => updateArrows();
    // Observe the RAIL's own box, not window resize: a viewport change reflows
    // the rail, which can leave the active step off center even though the
    // step never changed. ResizeObserver fires post-layout with fresh
    // geometry, so the re-center it schedules can never compute against stale
    // widths (the failure mode of window-resize timing). Scroll position alone
    // never triggers it, so user-driven scrolling is never yanked back.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { scheduleCenter(true); updateArrows(); });
      ro.observe(el);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [updateArrows, scheduleCenter]);

  // Center the active step whenever it changes. block:'nearest' guarantees no
  // vertical page jump; reduced-motion users get an instant jump instead.
  useEffect(() => {
    scheduleCenter(false);
    updateArrows();
  }, [step, scheduleCenter, updateArrows]);

  const nudge = (dx: number) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dx, behavior: reducedMotion() ? 'instant' : 'smooth' });
  };

  const progress = STEPS.length > 1 ? ((step - 1) / (STEPS.length - 1)) * 100 : 0;

  const arrowBtn = (dir: -1 | 1, label: string, enabled: boolean): React.CSSProperties => ({
    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, fontWeight: 800, lineHeight: 1, color: '#fff',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(139,92,246,0.28)',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.3,
    fontFamily: 'inherit', padding: 0,
    transition: 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
  });

  return (
    <div
      className="sp-stepper"
      role="navigation"
      aria-label="Content creation progress"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '18px 24px 14px',
        minHeight: 118,
        borderRadius: 999,
        background: 'linear-gradient(180deg, #111321 0%, #090B15 100%)',
        border: '1px solid rgba(139,92,246,0.18)',
        boxShadow: '0 12px 40px rgba(15,23,42,0.18), 0 0 24px rgba(124,58,237,0.10)',
      }}
    >
      <style>{`
        .sp-stepper-rail { scrollbar-width: none; -ms-overflow-style: none; scroll-snap-type: x proximity; }
        .sp-stepper-rail::-webkit-scrollbar { display: none; }
        .sp-stepper-rail > div { scroll-snap-align: center; }
        .sp-step-label { font-size: clamp(11px, 1vw, 14px) !important; white-space: nowrap; }
        .sp-step-arrow:not(:disabled):hover { transform: scale(1.05); box-shadow: 0 0 16px rgba(139,92,246,0.45); }
        .sp-step-arrow:focus-visible, .sp-step-item:focus-visible { outline: 2px solid #A855F7; outline-offset: 2px; }
        .sp-step-circle { width: 42px; height: 42px; font-size: 14px; }
        @media (max-width: 768px) {
          .sp-step-circle { width: 36px !important; height: 36px !important; font-size: 12px !important; }
          .sp-stepper { padding: 14px 16px 12px; }
        }
        @keyframes spStepPop { 0% { transform: scale(0.92); } 55% { transform: scale(1.05); } 100% { transform: scale(1); } }
        @keyframes spCheckIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) {
          .sp-stepper *, .sp-stepper *::before, .sp-stepper *::after { animation: none !important; transition: none !important; }
          .sp-stepper-rail { scroll-behavior: auto !important; }
        }
      `}</style>

      <button
        type="button"
        aria-label="Scroll steps left"
        disabled={!canLeft}
        onClick={() => nudge(-260)}
        className="sp-step-arrow"
        style={arrowBtn(-1, 'Scroll steps left', canLeft)}
      >
        ‹
      </button>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          ref={railRef}
          className="sp-stepper-rail"
          style={{
            display: 'flex', alignItems: 'center',
            overflowX: 'auto', overflowY: 'hidden',
            whiteSpace: 'nowrap', scrollBehavior: 'smooth',
            padding: '6px 2px 2px',
          }}
        >
          {STEPS.map((s, i) => {
            const done = s.n < step;
            const active = s.n === step;
            return (
              <div
                key={s.n}
                ref={active ? activeRef : undefined}
                style={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative' }}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
                      width: 34, height: 4, borderRadius: 999,
                      background: 'linear-gradient(90deg,#8B5CF6,#D946EF)',
                      boxShadow: '0 0 12px rgba(139,92,246,0.8)',
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => { if (s.n < step) go(s.n); }}
                  disabled={s.n > step}
                  aria-current={active ? 'step' : undefined}
                  title={s.n < step ? `Go back to ${s.t}` : s.t}
                  className="sp-step-item"
                  style={{
                    background: active ? 'rgba(124,58,237,0.10)' : 'none',
                    border: 'none',
                    borderRadius: 18,
                    padding: active ? '8px 14px' : '8px 10px',
                    boxShadow: active ? '0 0 20px rgba(139,92,246,0.16)' : 'none',
                    cursor: s.n < step ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', gap: 10,
                    fontFamily: 'inherit', whiteSpace: 'nowrap',
                    transition: 'background 200ms ease, box-shadow 200ms ease',
                  }}
                >
                  <span
                    className="sp-step-circle"
                    style={{
                      borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800,
                      background: done || active
                        ? 'linear-gradient(135deg,#7C3AED,#A855F7)'
                        : '#1E2436',
                      color: done || active ? '#fff' : 'rgba(226,232,240,0.55)',
                      border: active
                        ? 'none'
                        : done ? 'none' : '1px solid rgba(148,163,184,0.35)',
                      boxShadow: active
                        ? '0 0 0 4px rgba(139,92,246,.12), 0 0 20px rgba(139,92,246,.45)'
                        : done ? '0 0 12px rgba(139,92,246,.25)' : 'none',
                      animation: active ? 'spStepPop 350ms ease-out' : undefined,
                    }}
                  >
                    {done ? (
                      <span style={{ display: 'inline-block', animation: 'spCheckIn 300ms ease-out' }}>✓</span>
                    ) : s.n}
                  </span>
                  <span
                    className="sp-step-label"
                    style={{
                      fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
                      color: done || active ? '#F8FAFC' : 'rgba(226,232,240,.65)',
                    }}
                  >
                    {s.t}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'relative', flexShrink: 0,
                      width: 'clamp(22px, 3.5vw, 48px)', height: 3, borderRadius: 3,
                      margin: '0 8px', background: '#2A3044', overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(90deg,#7C3AED,#A855F7)',
                        transform: `scaleX(${s.n < step ? 1 : 0})`,
                        transformOrigin: 'left center',
                        transition: 'transform 400ms ease-out',
                      }}
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step}
          aria-label="Wizard progress"
          style={{ position: 'relative', height: 5, borderRadius: 999, background: '#232839', margin: '0 2px' }}
        >
          <div
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${progress}%`, borderRadius: 999,
              background: 'linear-gradient(90deg,#6D28D9,#8B5CF6,#D946EF)',
              boxShadow: '0 0 10px rgba(139,92,246,0.5)',
              transition: 'width 400ms ease-out',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)',
                width: 11, height: 11, borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, #fff 0%, #C4B5FD 45%, #8B5CF6 100%)',
                boxShadow: '0 0 10px rgba(168,85,247,0.9)',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-label="Scroll steps right"
        disabled={!canRight}
        onClick={() => nudge(260)}
        className="sp-step-arrow"
        style={arrowBtn(1, 'Scroll steps right', canRight)}
      >
        ›
      </button>
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
  // selectedPlatforms is the single source of truth: keep the preview tab
  // inside the selection so Preview never shows an unselected platform.
  useEffect(() => {
    if (p.selectedPlatforms.length > 0 && !p.selectedPlatforms.includes(previewPlatform)) {
      const first = p.selectedPlatforms.includes('linkedin') ? 'linkedin' : p.selectedPlatforms[0];
      setPreviewPlatform(first);
      if (p.platformContent[first]) p.switchPreviewPlatform(first);
    }
  }, [p.selectedPlatforms]);
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
  // ---- Step 4 local UI state (workspace mode + AI prompt editor only) ----
  // mediaTab switches the featured workspace panel (AI / upload / library).
  // All panels stay reachable — nothing is unmounted for good, and every
  // action below calls the existing page.tsx handlers (no new APIs).
  const [mediaTab, setMediaTab] = field<'ai' | 'upload' | 'library'>('mediaTab', 'ai');
  const [useContentContext, setUseContentContext] = field('useContentContext', true);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [genGate, setGenGate] = useState(false);
  const [genRunId, setGenRunId] = useState(0);
  const [genFinishing, setGenFinishing] = useState(false);
  const prevGeneratingRef = useRef(p.isGeneratingImage);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!prevGeneratingRef.current && p.isGeneratingImage) {
      setGenFinishing(false);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      setGenGate(true);
      setGenRunId(id => id + 1);
    }
    prevGeneratingRef.current = p.isGeneratingImage;
  }, [p.isGeneratingImage]);
  useEffect(() => () => {
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
  }, []);
  const handleGenReveal = () => {
    setGenGate(false);
    setGenFinishing(true);
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    finishTimerRef.current = setTimeout(() => setGenFinishing(false), 650);
  };
  // ---- Step 4 local UI state (selection/filters/menus/previews only) ----
  // Gallery card selection drives "Edit Selected in Canva". Null = nothing
  // clicked yet, in which case the first gallery image is the edit target.
  const [selectedMediaId, setSelectedMediaId] = field<string | null>('selectedMediaId', null);
  const [galleryFilter, setGalleryFilter] = field<'all' | 'ai' | 'upload' | 'canva' | 'branded'>('galleryFilter', 'all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dragSlideId, setDragSlideId] = useState<string | null>(null);
  const [dragOverSlideId, setDragOverSlideId] = useState<string | null>(null);
  const [showSlidePicker, setShowSlidePicker] = useState(false);
  const [showRegenPicker, setShowRegenPicker] = useState(false);
  const [showPreviewMenu, setShowPreviewMenu] = useState(false);
  // Step 7 post-preview modal (transient overlay state only — all content
  // state lives in page.tsx and is untouched by open/close).
  const [showPostPreview, setShowPostPreview] = useState(false);
  // Step 2: remembers a blocked Generate click so the reason is shown as an
  // unmissable error instead of a dead click (a disabled button fires nothing).
  const [genBlockerFlash, setGenBlockerFlash] = useState(false);
  const previewBtnRef = useRef<HTMLButtonElement | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!showPostPreview) return;
    previewCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPostPreview(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previewBtnRef.current?.focus(); };
  }, [showPostPreview]);
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = e.currentTarget as HTMLElement;
    const f = Array.from(root.querySelectorAll<HTMLElement>('button, [href], select, textarea, input, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const openPostPreview = () => {
    if (p.selectedPlatforms.length > 0 && !p.selectedPlatforms.includes(previewPlatform)) {
      const first = p.selectedPlatforms.includes('linkedin') ? 'linkedin' : p.selectedPlatforms[0];
      setPreviewPlatform(first);
      if (p.platformContent[first]) p.switchPreviewPlatform(first);
    }
    setShowPostPreview(true);
  };
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
  const accessibilityMedia = currentStep === 6 ? [...p.mediaItems, ...postExtraImages] : postPublishMedia;
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

  // Auto-advance: when AI content finishes generating, move to Step 3 (review).
  // If content already exists (user re-clicks Generate), goNext is handled
  // by the button below — this only auto-advances fresh generations.
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
  // Single local alias for the selection list. The platform rows, the
  // "Selected for content" summary and the Generate button all read the SAME
  // state through this one reference — no second selection state is introduced,
  // and it keeps the props bag from being re-read at every use site.
  const selectedPlatforms = p.selectedPlatforms;
  const selectedPlatformCount = selectedPlatforms.length;
  const canGenContent = !p.isGeneratingContent && hasTopic && genPlatformSelected;
  const genContentBlocker = !hasTopic
    ? 'Enter a topic first (Step 1)'
    : !genPlatformSelected
      ? 'Select at least one platform.'
      : '';
  const canGenImage = !p.isGeneratingImage && !!p.aspectRatio && !!p.content.trim();

  const activeTags = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
  const sentences = p.content ? p.content.split(/[.!?]+/).filter(s => s.trim()).length : 0;

  const saveDraft = p.saveFullDraft;

  const downloadGeneratedMedia = () => {
    const url = p.generatedVideo || p.generatedImage;
    if (!url) return;
    const isVideo = !!p.generatedVideo;
    const ext = isVideo ? 'mp4' : (url.match(/^data:image\/(\w+)/)?.[1] || 'jpg');
    const a = document.createElement('a');
    a.href = url;
    a.download = `socialpulse-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const goNext = () => setCurrentStep(s => Math.min(8, s + 1));
  const goBack = () => setCurrentStep(s => Math.max(1, s - 1));

  // Every step change (Next, Back, stepper jumps, Preview/Add-Image shortcuts,
  // auto-advance) starts the next page at the very top.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

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
    <div className="sp-wiz-root" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(10px, 1.5vw, 14px)', padding: 'clamp(12px, 2vw, 20px)', flex: 1, alignItems: 'stretch', minHeight: 'calc(100vh - 64px)', maxWidth: 1180, width: '100%', minWidth: 0, margin: '0 auto' }}>
      <style>{`
        .sp-wiz-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sp-wiz-prev { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 14px; align-items: start; }
        .sp-wiz-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .sp-wiz-title2 { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
        .sp-wiz-media2 { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; align-items: stretch; }
        .sp-s1-grid { display: grid; gap: clamp(10px, 1.5vw, 18px); align-items: start; }
        /* Desktop >=1200: editor ~73% / helper ~27%. Laptop 900–1199: same
           two columns, tighter. Tablet/mobile <900: single column — helper
           cards flow below the editor in DOM order. */
        @media (min-width: 1200px) { .sp-s1-grid { grid-template-columns: minmax(0,2.2fr) minmax(260px,0.8fr); } }
        @media (min-width: 900px) and (max-width: 1199px) { .sp-s1-grid { grid-template-columns: minmax(0,1.8fr) minmax(240px,0.8fr); } }
        @media (max-width: 899px) { .sp-s1-grid { grid-template-columns: 1fr; } }
        /* Laptop: reduce Step 1 card padding so the UI never looks zoomed-out. */
        @media (min-width: 900px) and (max-width: 1199px) { .sp-s1-card { padding: 20px 18px !important; } }
        @media (max-width: 699px) { .sp-s1-card { padding: 18px 14px !important; border-radius: 16px !important; } }
        /* Mobile single column: helper aside stacks below the editor. */
        @media (max-width: 899px) { .sp-s1-grid > aside { position: static; } }
        .sp-s1-ta { transition: border-color 0.18s, box-shadow 0.18s, background-color 0.18s; }
        .sp-s1-ta:focus { border-color: #7C3AED !important; box-shadow: 0 0 0 4px rgba(124,58,237,0.14) !important; background-color: #fff !important; }
        .sp-s1-pill { transition: all 0.16s; }
        .sp-s1-pill:hover { border-color: #7C3AED !important; background-color: #F1EBFF !important; color: #6D28D9 !important; transform: translateY(-1px); box-shadow: 0 3px 10px rgba(124,58,237,0.16); }
        .sp-s1-drop { transition: all 0.18s; cursor: pointer; }
        .sp-s1-drop:hover { border-color: #7C3AED !important; background-color: #EDE9FE !important; }
        .sp-s1-drop:focus-visible { outline: 2px solid #A855F7; outline-offset: 2px; }
        .sp-cloud { animation: spCloudFloat 4.5s ease-in-out infinite; transition: transform .18s ease; }
        @keyframes spCloudFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        /* Image slots: 4 columns desktop, 2 columns tablet, auto-fit on mobile
           (2 columns at phone widths, 1 column only when extremely narrow). */
        .sp-topic-slots { display: grid; gap: 10px; margin-top: 10px; grid-template-columns: repeat(4, 1fr); }
        @media (min-width: 700px) and (max-width: 899px) { .sp-topic-slots { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 699px) { .sp-topic-slots { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); } }
        /* Mobile social card: smaller badges, shorter travel, same containment. */
        @media (max-width: 700px) {
          .sp-soc { width: 44px; height: 44px; }
          .sp-soc-visual { height: 188px; }
          .sp-robot { width: 62px; height: 62px; margin-left: -31px; margin-top: -31px; font-size: 32px; }
          .sp-orbit { width: 120px; height: 120px; margin-left: -60px; margin-top: -60px; }
          @keyframes spDriftLi { 0%,100% { transform: translate(0,0) rotate(-3deg); } 50% { transform: translate(5px,6px) rotate(3deg); } }
          @keyframes spDriftIg { 0%,100% { transform: translate(0,0) rotate(3deg); } 50% { transform: translate(-5px,6px) rotate(-3deg); } }
          @keyframes spFloatY { 0%,100% { transform: translateY(-3px); } 50% { transform: translateY(4px); } }
          @keyframes spFloatDiag { 0%,100% { transform: translate(-2px,-2px); } 50% { transform: translate(4px,4px); } }
        }
        /* Step 1 nav: Next goes full-width with a 44px+ touch target on phones. */
        @media (max-width: 699px) {
          .sp-step-nav { flex-direction: column; align-items: stretch !important; }
          .sp-step-nav .sp-next { width: 100%; min-height: 48px; }
        }
        .sp-wiz-root img { max-width: 100%; }
        /* --- Step 1 inspiration card: zoned social animation (visual zone is
               position:relative + overflow:hidden; icons are absolutely
               positioned INSIDE it with small translate ranges so they can
               never enter the text zone below) --- */
        .sp-soc-visual { position: relative; overflow: hidden; height: 212px; }
        .sp-soc { position: absolute; width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; cursor: default; transition: transform 180ms ease, box-shadow 180ms ease; will-change: transform; }
        .sp-soc:hover { transform: scale(1.06); }
        .sp-robot { position: absolute; left: 50%; top: 50%; width: 74px; height: 74px; margin-left: -37px; margin-top: -37px; border-radius: 24px; background: linear-gradient(135deg,#7C3AED,#A855F7); display: flex; align-items: center; justify-content: center; font-size: 38px; box-shadow: 0 10px 28px rgba(124,58,237,.45), inset 0 1px 0 rgba(255,255,255,.35); z-index: 2; }
        .sp-orbit { position: absolute; left: 50%; top: 50%; width: 150px; height: 150px; margin-left: -75px; margin-top: -75px; border: 1.5px dashed rgba(124,58,237,.35); border-radius: 50%; pointer-events: none; animation: spSpinSlow 24s linear infinite; }
        @keyframes spDriftLi { 0%,100% { transform: translate(0,0) rotate(-3deg); } 50% { transform: translate(9px,10px) rotate(3deg); } }
        @keyframes spDriftIg { 0%,100% { transform: translate(0,0) rotate(3deg); } 50% { transform: translate(-9px,10px) rotate(-3deg); } }
        @keyframes spFloatY { 0%,100% { transform: translateY(-5px); } 50% { transform: translateY(6px); } }
        @keyframes spFloatDiag { 0%,100% { transform: translate(-4px,-4px); } 50% { transform: translate(6px,6px); } }
        @keyframes spBreathe { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-5px) scale(1.03); } }
        @keyframes spSpinSlow { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .sp-soc, .sp-robot, .sp-orbit, .sp-cloud { animation: none !important; transition: none !important; } }
        .sp-s2-grid { display: grid; grid-template-columns: minmax(0,1fr) 320px; gap: 16px; align-items: start; }
        .sp-prev-grid { display: grid; grid-template-columns: minmax(0,2.1fr) minmax(300px,1fr); gap: 24px; align-items: start; }
        @media (max-width: 1024px) { .sp-prev-grid { grid-template-columns: 1fr; } }
        .sp-review-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; align-items: start; }
        @media (max-width: 1024px) { .sp-review-grid { grid-template-columns: 1fr; } }
        .sp-step7-grid { display: grid; grid-template-columns: minmax(0,1.7fr) minmax(320px,0.8fr); gap: 24px; align-items: start; }
        @media (max-width: 1024px) { .sp-step7-grid { grid-template-columns: 1fr; } .sp-step7-grid > div { display: contents; } .sp-ord-select { order: 1; } .sp-ord-final { order: 2; } .sp-ord-ready { order: 3; } .sp-ord-best { order: 4; } .sp-ord-banner { order: 5; } }
        .sp-prev-trio { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; align-items: start; }
        @media (max-width: 1024px) { .sp-prev-trio { grid-template-columns: 1fr 1fr; } .sp-prev-trio > :last-child { grid-column: 1 / -1; } }
        @media (max-width: 700px) { .sp-prev-trio { grid-template-columns: 1fr; } .sp-prev-trio > :last-child { grid-column: auto; } }
        .sp-s2-opt { transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s, background-color 0.16s; }
        .sp-s2-opt:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(15,23,42,0.10); }
        .sp-ai-arrive { animation: spAiArrive 600ms ease both; }
        @keyframes spAiArrive { from { opacity: 0.35; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .sp-ai-arrive { animation: none; } }
        @media (max-width: 1024px) { .sp-s2-grid { grid-template-columns: 1fr; } }
        @media (max-width: 900px) { .sp-wiz-grid2, .sp-wiz-prev, .sp-wiz-media2 { grid-template-columns: 1fr; } }
        @media (max-width: 700px) { .sp-wiz-grid3 { grid-template-columns: 1fr; } }

        /* --- Overflow containment -------------------------------------------------
           Every flex/grid item defaults to min-width:auto, so it refuses to shrink
           below its content's min-content width. The 8-step WizardStepper is 8 x
           100px = 923px wide; it is a deliberate horizontal SCROLL region, but its
           parent card inherited that 923px min-content and grew to match, dragging
           the whole document wide on phones. Constraining each item to min-width:0
           lets the scroll region clip as intended and keeps the page at 100%. */
        .sp-wiz-root, .sp-wiz-root > * { min-width: 0; max-width: 100%; }
        .sp-s1-grid > *, .sp-s2-grid > *, .sp-wiz-grid2 > *, .sp-wiz-grid3 > *,
        .sp-wiz-prev > *, .sp-wiz-media2 > *, .sp-prev-grid > *, .sp-review-grid > *,
        .sp-step7-grid > *, .sp-prev-trio > * { min-width: 0; max-width: 100%; }
        .sp-s1-grid, .sp-s2-grid, .sp-wiz-grid2, .sp-wiz-grid3, .sp-wiz-prev,
        .sp-wiz-media2, .sp-prev-grid, .sp-review-grid, .sp-step7-grid, .sp-prev-trio { min-width: 0; }
        /* Text must never widen a track. */
        .sp-wiz-root p, .sp-wiz-root span, .sp-wiz-root h1, .sp-wiz-root h2,
        .sp-wiz-root h3, .sp-wiz-root label { overflow-wrap: anywhere; }
        @media (max-width: 768px) { .sp-wiz-root { padding: 14px; gap: 12px; } }
      `}</style>

      <div style={{ ...card, padding: '14px 20px' }}>
        <WizardStepper step={currentStep} go={setCurrentStep} />
      </div>

      <div style={currentStep === 1 || currentStep === 2 || currentStep === 3 || currentStep === 4 || currentStep === 5 || currentStep === 6 || currentStep === 7 || currentStep === 8 ? { background: 'transparent' } : { ...card, padding: '28px 32px' }}>
        {/* ================= STEP 1 — IDEA ================= */}
        {currentStep === 1 && (
          <div className="sp-s1-grid">
            {/* ============ LEFT — TOPIC & IDEA CARD ============ */}
            <div className="sp-s1-card" style={{ ...card, borderRadius: 20, padding: '28px 24px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#FEF3C7', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>💡</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'clamp(18px, 2vw, 22px)', fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Topic & Idea</div>
                  <div style={{ fontSize: 'clamp(12px, 1.2vw, 13px)', color: C.muted, marginTop: 4, lineHeight: 1.6 }}>Describe your post idea, topic, or key message. The more details you provide, the better the results.</div>
                </div>
              </div>

              <textarea
                value={p.prompt}
                onChange={e => p.setPrompt(e.target.value.slice(0, 2000))}
                placeholder="e.g. Tips for staying productive while working from home..."
                className="sp-s1-ta"
                style={{ width: '100%', boxSizing: 'border-box', minHeight: 148, padding: '16px 18px', border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 14, lineHeight: 1.7, color: C.ink, backgroundColor: '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, gap: 12 }}>
                <span style={{ fontSize: 11.5, color: C.faint, fontStyle: 'italic', lineHeight: 1.5 }}>Example: “5 tips for staying productive while working from home, target audience is remote professionals, friendly tone”</span>
                <span style={{ fontSize: 11.5, color: C.faint, flexShrink: 0, fontWeight: 700 }}>{p.prompt.length}/500</span>
              </div>

              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginTop: 20, marginBottom: 10 }}>Need inspiration? Try these examples:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  ['🚀', 'Product Launch', 'Announcing the launch of our new product! Share the key features, benefits and an early-bird offer for our audience, exciting and bold tone.'],
                  ['💡', 'Tips & Tutorials', '5 tips for staying productive while working from home, target audience is remote professionals, friendly tone'],
                  ['🎬', 'Behind the Scenes', 'Behind the scenes: a day in the life of our team building our latest release, casual and authentic tone'],
                  ['👥', 'Customer Stories', 'Customer success story: how our client grew their audience with our platform, inspirational tone'],
                  ['📅', 'Event Announcement', 'Join us for our live webinar next Friday! What to expect, who should attend and how to register, upbeat tone'],
                ].map(([icon, label, example]) => (
                  <button key={label} onClick={() => p.setPrompt(example)} className="sp-s1-pill" style={{ padding: '8px 15px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: `1.5px solid ${C.border}`, backgroundColor: '#fff', color: '#334155', cursor: 'pointer', fontFamily: 'inherit' }}>{icon} {label}</button>
                ))}
              </div>

              <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginTop: 24 }}>Reference Images (Optional)</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 12 }}>Upload up to 4 images to guide AI and match your vision.</div>
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload reference images"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.topicFileInputRef.current?.click(); } }}
                onClick={() => p.topicFileInputRef.current?.click()}
                onDragOver={p.handleDragOver}
                onDragEnter={e => { e.preventDefault(); p.setDragOverTopic(true); p.setTopicDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); p.setDragOverTopic(false); p.setTopicDragOver(false); }}
                onDrop={p.handleTopicDrop}
                className="sp-s1-drop"
                style={{ position: 'relative', overflow: 'hidden', border: `2px dashed ${p.dragOverTopic ? '#6D28D9' : '#C4B5FD'}`, background: p.dragOverTopic ? '#EDE9FE' : 'linear-gradient(180deg,#FAF8FF 0%,#F5F1FF 100%)', boxShadow: p.dragOverTopic ? '0 0 0 4px rgba(124,58,237,0.16)' : 'none', borderRadius: 16, padding: '30px 20px 26px', textAlign: 'center' }}
              >
                <span aria-hidden="true" style={{ position: 'absolute', top: 16, left: 22, fontSize: 15, opacity: 0.55, pointerEvents: 'none' }}>✨</span>
                <span aria-hidden="true" style={{ position: 'absolute', top: 20, right: 26, fontSize: 15, opacity: 0.55, pointerEvents: 'none' }}>🖼️</span>
                <div className="sp-cloud" style={{ width: 52, height: 52, borderRadius: '50%', background: '#fff', border: '1px solid #E8EAF1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto', boxShadow: '0 4px 14px rgba(124,58,237,0.12)', transform: p.dragOverTopic ? 'scale(1.1)' : undefined }}>☁️</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 12 }}>{p.dragOverTopic ? 'Drop images to add them' : 'Drag & drop images here'}</div>
                <div style={{ fontSize: 12.5, color: C.primaryDark, fontWeight: 700, marginTop: 2 }}>or click to upload</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Supports JPG, PNG, WEBP (Max 5MB each)</div>
              </div>
              {p.topicMediaItems.filter(i => i.type === 'image').length > 0 && (
              <div className="sp-topic-slots">
                {p.topicMediaItems.filter(i => i.type === 'image').map(item => (
                  <div key={item.id} title={item.name} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}`, aspectRatio: '1', backgroundColor: '#000', minWidth: 0 }}>
                    <img src={item.url} alt={item.altText || item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, fontSize: 10, color: '#fff', background: 'linear-gradient(0deg,rgba(0,0,0,0.72),transparent)', padding: '14px 6px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{item.name}</div>
                    <button onClick={() => p.removeTopicMedia(item.id)} title="Remove image" aria-label={`Remove ${item.name}`} style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: '50%', backgroundColor: 'rgba(15,23,42,0.78)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                    <span title="Added" style={{ position: 'absolute', left: 5, top: 5, minWidth: 20, height: 20, borderRadius: 999, backgroundColor: '#059669', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>✓</span>
                    <button onClick={() => p.openInCanva(item.url)} disabled={p.isSendingToCanva} title="Edit this image in Canva" style={{ position: 'absolute', bottom: 5, right: 5, height: 22, padding: '0 8px', borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.92)', color: '#0F172A', border: '1px solid #E2E8F0', cursor: p.isSendingToCanva ? 'wait' : 'pointer', fontSize: 10, fontWeight: 800 }}>🎨 Edit</button>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 4 - p.topicMediaItems.length) }).map((_, i) => (
                  <button key={`slot-${i}`} onClick={() => p.topicFileInputRef.current?.click()} title="Add image" style={{ borderRadius: 12, border: '1.5px dashed #C4B5FD', backgroundColor: '#FAF8FF', cursor: 'pointer', aspectRatio: '1', color: C.primary, fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0 }}><span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>+</span><span style={{ fontSize: 11, fontWeight: 700 }}>Add Image</span></button>
                ))}
              </div>
              )}
              <input ref={p.topicFileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={p.handleTopicUpload} style={{ display: 'none' }} />

              <div className="sp-step-nav" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}` }}>
                <div style={{ flex: 1 }}>
                  {!hasTopic && <span style={{ fontSize: 12, color: '#92400E', fontWeight: 600 }}>Topic required — describe your post or add a reference image to continue.</span>}
                </div>
                <button
                  className="sp-next"
                  onClick={goNext}
                  disabled={!hasTopic}
                  title={!hasTopic ? 'Enter a topic or add a reference image first' : 'Continue'}
                  style={{
                    minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800,
                    border: 'none', cursor: hasTopic ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                    background: hasTopic ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : '#DDD6FE', color: '#fff',
                    boxShadow: hasTopic ? '0 6px 22px rgba(124,58,237,0.42)' : 'none',
                  }}
                >Next →</button>
              </div>
            </div>

            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ borderRadius: 20, background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <div className="sp-soc-visual" aria-hidden="true">
                  <span className="sp-orbit" />
                  <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: p.platformColors.linkedin || '#0A66C2', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /></span>
                  <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, background: 'linear-gradient(45deg,#F58529,#DD2A7B 45%,#8134AF 75%,#515BD4)', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /></span>
                  <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: p.platformColors.facebook || '#1877F2', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /></span>
                  <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: p.platformColors.whatsapp || '#25D366', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /></span>
                  <span className="sp-robot" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}>🤖</span>
                </div>
                <div style={{ padding: '18px 16px 20px', borderTop: '1px solid rgba(233,213,255,0.7)' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>A great idea leads to great content ✨</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.65 }}>Share your thoughts, add reference images, and let AI bring your ideas to life.</div>
                </div>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 16px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 12 }}>Tips to write a good idea:</div>
                {['Be specific', 'Mention your audience', 'Include key message', 'Add tone (e.g. professional, casual)', 'Attach reference images'].map(tip => (
                  <div key={tip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>{tip}</span>
                  </div>
                ))}
              </div>

              <div style={{ borderRadius: 20, padding: '20px 16px', background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: '#FEF3C7', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🎯</div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#92400E' }}>Pro Tip</div>
                  <div style={{ fontSize: 12, color: '#92400E', marginTop: 4, lineHeight: 1.65 }}>The more details you provide, the better the AI understands your vision.</div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 2 — SETTINGS ================= */}
        {currentStep === 2 && (
          <div className="sp-s2-grid">
            {/* ============ LEFT — MAIN SETTINGS CARD ============ */}
            <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🎛️</div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Creative Settings</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Step 2 of 8: Customize your content style and platform preferences</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F5F0FF', border: '1px solid #DDD6FE', borderRadius: 14, padding: '12px 16px', marginBottom: 22 }}>
                <span style={{ fontSize: 16, lineHeight: 1.4 }}>💡</span>
                <span style={{ fontSize: 12.5, color: C.primaryDark, fontWeight: 600, lineHeight: 1.6 }}>Tailor your content to match your audience and platform for better results.</span>
              </div>

              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>1. Select Tone</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>Choose the tone that matches your brand voice</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 24 }}>
                {[
                  ['Professional', '💼', 'Polished, credible and business-ready'],
                  ['Casual', '😊', 'Friendly, relatable and conversational'],
                  ['Inspirational', '✨', 'Motivating and positive'],
                  ['Educational', '📚', 'Informative and knowledge-focused'],
                ].map(([k, i, d]) => {
                  const active = p.tone === k;
                  return (
                    <button key={k} onClick={() => p.setTone(k)} className="sp-s2-opt" style={selectCardPremium(active)}>
                      <span style={checkBadge(active)}>{active ? '✓' : ''}</span>
                      <span style={{ fontSize: 24 }}>{i}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: active ? C.primaryDark : C.ink }}>{k}</span>
                      <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{d}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>2. Select Image Style</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>Choose the visual style for your AI-generated media</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 24 }}>
                {[
                  ['Photographic', '📷', 'Realistic and true-to-life'],
                  ['Digital Art', '🎨', 'Creative and illustrated'],
                  ['Cinematic', '🎬', 'Movie-like and dramatic'],
                  ['Anime', '🌸', 'Stylized and animated'],
                ].map(([k, i, d]) => {
                  const active = p.imageStyle === k;
                  return (
                    <button key={k} onClick={() => p.setImageStyle(k)} className="sp-s2-opt" style={selectCardPremium(active)}>
                      <span style={checkBadge(active)}>{active ? '✓' : ''}</span>
                      <span style={{ fontSize: 24 }}>{i}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: active ? C.primaryDark : C.ink }}>{k}</span>
                      <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{d}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>3. Select Aspect Ratio</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>Choose the aspect ratio for your post</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 24 }}>
                {(() => {
                  const desc: Record<string, string> = {
                    '1:1': 'Best for Instagram',
                    '9:16': 'Best for Stories & Reels',
                    '16:9': 'Best for LinkedIn, Facebook, YouTube',
                    '4:3': 'Good for most platforms',
                  };
                  const order = ['1:1', '9:16', '16:9', '4:3'];
                  const keys = [...order.filter(k => p.aspectRatioMap[k]), ...Object.keys(p.aspectRatioMap).filter(k => !order.includes(k))];
                  return keys.map(key => {
                    const val = p.aspectRatioMap[key];
                    const active = p.aspectRatio === key;
                    return (
                      <button key={key} onClick={() => p.setAspectRatio(key)} className="sp-s2-opt" style={{ ...selectCardPremium(active), alignItems: 'center', textAlign: 'center', paddingTop: 18 }}>
                        <span style={checkBadge(active)}>{active ? '✓' : ''}</span>
                        <span style={{
                          width: key === '1:1' ? 30 : key === '16:9' ? 40 : key === '9:16' ? 22 : 34,
                          height: key === '1:1' ? 30 : key === '16:9' ? 23 : key === '9:16' ? 36 : 26,
                          borderRadius: 6, border: `2.5px solid ${active ? C.primary : '#CBD5E1'}`,
                          backgroundColor: active ? '#fff' : '#F8FAFC', flexShrink: 0, display: 'block',
                        }} />
                        <span>
                          <span style={{ display: 'block', fontSize: 10, fontWeight: 800, color: active ? C.primaryDark : C.muted }}>{key}</span>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: active ? C.primaryDark : C.ink, marginTop: 1 }}>{val.label}</span>
                        </span>
                        <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{desc[key] || `Optimized for ${val.label}`}</span>
                      </button>
                    );
                  });
                })()}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>4. Choose Platforms</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Select where you want to generate content. Connect accounts when you&apos;re ready to publish.</div>
                </div>
                {selectedPlatformCount === 0 ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '4px 11px', borderRadius: 999 }}>Select at least one platform</span>
                ) : p.accounts.some(a => a.connected) || p.whapiConnected ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '4px 11px', borderRadius: 999 }}>Active</span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, backgroundColor: '#F7F8FC', border: `1px solid ${C.border}`, padding: '4px 11px', borderRadius: 999 }}>None connected yet</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
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
                    <div key={cfg.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', opacity: standby ? 0.6 : 1 }}>
                      {/* Selection is a CHECKBOX (multi-select) and is deliberately
                          a sibling of the Connect button, never nested inside it —
                          so Connect can never toggle the selection, and clicking the
                          row/checkbox never starts an OAuth flow. Both stay wired to
                          the one existing selectedPlatforms state via p.togglePlatform. */}
                      <span style={{ display: 'flex', alignItems: 'center', paddingLeft: 6, paddingRight: 0, flexShrink: 0 }}>
                        <input
                          type="checkbox"
                          checked={selected && !standby}
                          disabled={standby}
                          onChange={() => { if (!standby) p.togglePlatform(cfg.id); }}
                          aria-label={`Select ${cfg.label} for content generation`}
                          style={{ width: 16, height: 16, accentColor: C.primary, cursor: standby ? 'not-allowed' : 'pointer', margin: 0 }}
                        />
                      </span>
                      <button onClick={() => { if (!standby) p.togglePlatform(cfg.id); }} disabled={standby} className="sp-s2-opt" style={{
                        flex: 1, padding: '12px 14px', borderRadius: 14, cursor: standby ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                        // Purple = selected for GENERATION. Green is reserved for the
                        // connection indicator below, so the two states never read as
                        // the same thing.
                        border: selected && !standby ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`,
                        backgroundColor: selected && !standby ? '#F6F1FF' : '#fff', fontFamily: 'inherit',
                      }}>
                        <span style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <p.PlatformIcon platform={cfg.id} size={16} />
                        </span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: C.ink }}>{cfg.label} {selected && !standby ? <span style={{ color: C.primary }}>✓</span> : ''}</span>
                          <span style={{ display: 'block', fontSize: 11, fontWeight: 600, marginTop: 1, color: standby ? '#B45309' : connected ? '#059669' : C.faint }}>{standby ? 'On standby' : connected ? '● Connected' : '○ Not connected'}</span>
                        </span>
                      </button>
                      {!connected && !standby && !isWhapi && (
                        <button onClick={() => p.connectPlatform(cfg.id)} style={{ padding: '10px 20px', borderRadius: 11, fontSize: 12, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', alignSelf: 'center', boxShadow: '0 3px 10px rgba(124,58,237,0.3)', fontFamily: 'inherit' }}>Connect</button>
                      )}
                      {!connected && !standby && isWhapi && p.whapiCanConnect && (
                        <button onClick={() => p.startWhatsAppConnect()} style={{ padding: '10px 20px', borderRadius: 11, fontSize: 12, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', alignSelf: 'center', boxShadow: '0 3px 10px rgba(124,58,237,0.3)', fontFamily: 'inherit' }}>Connect</button>
                      )}
                      {connected && !standby && !isWhapi && (
                        <button onClick={() => p.disconnectPlatform(cfg.id)} style={{ padding: '10px 20px', borderRadius: 11, fontSize: 12, fontWeight: 800, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', whiteSpace: 'nowrap', alignSelf: 'center', fontFamily: 'inherit' }}>Disconnect</button>
                      )}
                      {connected && !standby && isWhapi && (
                        <button onClick={() => p.disconnectWhatsApp()} disabled={p.whatsappDisconnecting || p.whapiLoading} style={{ padding: '10px 20px', borderRadius: 11, fontSize: 12, fontWeight: 800, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: (p.whatsappDisconnecting || p.whapiLoading) ? 'wait' : 'pointer', whiteSpace: 'nowrap', alignSelf: 'center', fontFamily: 'inherit', opacity: (p.whatsappDisconnecting || p.whapiLoading) ? 0.6 : 1 }}>{p.whatsappDisconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
                      )}
                      </div>

                      {/* Per-account targets. Only meaningful once the platform is
                          selected — it fans the publish out to every checked
                          account instead of just the first connected one. */}
                      {selected && !standby && !isWhapi && p.accounts.filter(a => a.platform === cfg.id && a.connected).length > 0 && (() => {
                        const accs = p.accounts.filter(a => a.platform === cfg.id && a.connected);
                        const keys = accs.map(a => `${a.platform}:${a.userId}:${a.pageId || ''}`);
                        const chosenCount = keys.filter(k => p.selectedAccountKeys.includes(k)).length;
                        return (
                          <div style={{ marginLeft: 10, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 12, backgroundColor: '#FCFCFE' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.faint }}>
                                Post to {chosenCount}/{accs.length} account{accs.length === 1 ? '' : 's'}
                              </span>
                              <button
                                type="button"
                                onClick={() => (chosenCount === keys.length ? p.clearAccountsFor(cfg.id) : p.selectAllAccountsFor(cfg.id))}
                                style={{ border: 'none', background: 'none', color: C.primaryDark, fontSize: 10.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                              >
                                {chosenCount === keys.length ? 'Clear all' : 'Select all'}
                              </button>
                            </div>
                            {accs.map((a) => {
                              const key = `${a.platform}:${a.userId}:${a.pageId || ''}`;
                              const on = p.selectedAccountKeys.includes(key);
                              return (
                                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 8, backgroundColor: on ? '#F5F3FF' : 'transparent' }}>
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => p.toggleAccount(key)}
                                    style={{ width: 14, height: 14, accentColor: C.primary, cursor: 'pointer', flexShrink: 0 }}
                                  />
                                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {a.name || a.email || a.userId.slice(0, 10)}
                                  </span>
                                  {a.pageId && a.pages?.length ? (
                                    <span style={{ fontSize: 10, fontWeight: 700, color: C.faint, flexShrink: 0 }}>
                                      {a.pages.find(pg => pg.id === a.pageId)?.name || 'Page'}
                                    </span>
                                  ) : null}
                                </label>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Compact read-back of the ONE selection state, so it is obvious
                  which platforms generation will target. Reads from
                  selectedPlatforms — never a second source of truth. */}
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, backgroundColor: selectedPlatformCount ? '#F6F1FF' : '#F7F8FC', border: `1px solid ${selectedPlatformCount ? '#E4DBFF' : C.borderSoft}` }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.faint }}>Selected for content</span>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: selectedPlatformCount ? C.primaryDark : C.muted, marginTop: 3 }}>
                  {selectedPlatformCount
                    ? (['linkedin', 'facebook', 'instagram', 'whatsapp'] as const)
                        .filter(pl => selectedPlatforms.includes(pl))
                        .map(pl => PLATFORM_LABELS[pl] || pl)
                        .join(', ')
                    : 'No platforms selected'}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Selection and connection are separate — you can generate content before connecting.</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}`, flexWrap: 'wrap' }}>
                <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => {
                  if (p.isGeneratingContent) return;
                  if (hasContent) { setGenBlockerFlash(false); goNext(); return; }
                  if (!canGenContent) { setGenBlockerFlash(true); return; }
                  setGenBlockerFlash(false);
                  p.generateContent();
                }} disabled={p.isGeneratingContent} title={p.isGeneratingContent ? 'Generating — please wait' : !canGenContent && !hasContent ? genContentBlocker : hasContent ? 'Content ready — continue to Content' : 'Generate content'} style={{ minHeight: 50, padding: '14px 24px', borderRadius: 12, fontSize: 13.5, fontWeight: 800, cursor: p.isGeneratingContent ? 'wait' : 'pointer', fontFamily: 'inherit', border: `1.5px solid ${(canGenContent || hasContent) ? C.primary : '#E8EAF1'}`, background: hasContent ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : '#fff', color: hasContent ? '#fff' : canGenContent ? C.primaryDark : '#B6BDCC', boxShadow: hasContent ? '0 6px 22px rgba(124,58,237,0.42)' : canGenContent ? '0 3px 12px rgba(124,58,237,0.14)' : 'none' }}>{hasContent ? 'Next →' : p.isGeneratingContent ? '⏳ Generating…' : selectedPlatformCount === 0 ? 'Select a Platform' : selectedPlatformCount === 1 ? '✨ Generate Content →' : `✨ Generate Content for ${selectedPlatformCount} Platforms →`}</button>
              </div>
              {!hasSettings && <div style={{ fontSize: 12, color: '#92400E', marginTop: 10, fontWeight: 600 }}>Aspect ratio required before the image flow — pick one above.</div>}
              {genBlockerFlash && !canGenContent && !hasContent && !p.isGeneratingContent && (
                <div style={{ fontSize: 12.5, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: 12, padding: '10px 14px', marginTop: 10, fontWeight: 700 }}>⚠️ {genContentBlocker}</div>
              )}
              {!genBlockerFlash && !canGenContent && !p.isGeneratingContent && (
                <div style={{ fontSize: 12, color: '#92400E', marginTop: 6 }}>
                  To enable Generate Content: {[!hasTopic ? 'add a topic (Step 1)' : null, !genPlatformSelected ? 'select a platform above' : null].filter(Boolean).join(' and ')}.
                </div>
              )}
            </div>

            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ position: 'relative', borderRadius: 20, padding: '26px 22px 22px', background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <span style={{ position: 'absolute', top: 14, left: 16, width: 30, height: 30, borderRadius: '50%', background: '#0A66C2', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(10,102,194,0.35)' }}>in</span>
                <span style={{ position: 'absolute', top: 44, right: 14, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>📸</span>
                <span style={{ position: 'absolute', bottom: 96, left: 12, width: 30, height: 30, borderRadius: '50%', background: '#1877F2', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(24,119,242,0.35)' }}>f</span>
                <span style={{ position: 'absolute', bottom: 120, right: 18, width: 30, height: 30, borderRadius: '50%', background: '#25D366', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(37,211,102,0.35)' }}>💬</span>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto', boxShadow: '0 8px 24px rgba(124,58,237,0.22)', border: '1px solid #E9D5FF' }}>🤖</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginTop: 14, letterSpacing: '-0.01em', lineHeight: 1.4 }}>Customize Your Content.<br />Make an Impact!</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, textAlign: 'left' }}>
                  {['Right tone', 'Perfect visuals', 'Multi-platform ready'].map(b => (
                    <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{b}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>💡 Quick Tips</div>
                {[
                  ['👥', 'Choose a tone that fits your audience'],
                  ['🖼️', 'Use visuals that match your message'],
                  ['📐', 'Select the right aspect ratio'],
                  ['🔗', 'Connect your accounts now'],
                ].map(([icon, tip]) => (
                  <div key={tip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', lineHeight: 1.5 }}>{tip}</span>
                  </div>
                ))}
              </div>

              <div style={{ borderRadius: 20, padding: '24px 22px', background: 'linear-gradient(135deg,#F5F0FF,#EDE9FE)', border: '1px solid #DDD6FE', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.primaryDark, lineHeight: 1.5, letterSpacing: '-0.01em' }}>Good Content<br />Builds Stronger<br />Connections</div>
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 3 — CONTENT ================= */}
        {currentStep === 3 && (
          <div className="sp-s2-grid">
            {/* ============ LEFT — MAIN AI CONTENT EDITOR CARD ============ */}
            <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>✨</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>AI Content Editor</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Step 3 of 8: Review and refine your generated content</div>
                </div>
                <button onClick={() => setShowRegenPicker(true)} disabled={!canGenContent} title={!canGenContent ? genContentBlocker : 'Choose what to regenerate — one platform or all'} style={{ padding: '10px 18px', borderRadius: 11, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${canGenContent ? C.primary : '#E8EAF1'}`, backgroundColor: '#fff', color: canGenContent ? C.primaryDark : '#B6BDCC', cursor: canGenContent ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>↻ Regenerate</button>
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setShowPreviewMenu(v => !v)} title="Switch the previewed platform — LinkedIn is the default" style={{ padding: '10px 18px', borderRadius: 11, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${C.primaryBorder}`, backgroundColor: C.primarySoft, color: C.primaryDark, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>👁 Preview: {p.activePreviewPlatform || '—'}</button>
                  {showPreviewMenu && (
                    <>
                      <div onClick={() => setShowPreviewMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
                      <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 200, backgroundColor: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 12px 32px rgba(15,23,42,0.18)', zIndex: 61, overflow: 'hidden', padding: 6 }}>
                        {p.selectedPlatforms.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: '10px 12px' }}>Select platforms in Step 2 first.</div>}
                        {p.selectedPlatforms.map(pl => {
                          const active = pl === p.activePreviewPlatform;
                          const brand = p.platformColors[pl] || C.primary;
                          return (
                            <button key={pl} onClick={() => { p.switchPreviewPlatform(pl); setShowPreviewMenu(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 8, border: 'none', background: active ? C.primarySoft : 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', textTransform: 'capitalize' }}>
                              <span style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <p.PlatformIcon platform={pl} size={12} />
                              </span>
                              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, color: active ? C.primaryDark : C.ink }}>{pl}</span>
                              {active && <span style={{ fontSize: 12, fontWeight: 800, color: C.primaryDark }}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {!p.content.trim() ? (
                <div style={{ border: '2px dashed #C4B5FD', borderRadius: 16, backgroundColor: '#FAF8FF', padding: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: 34 }}>📝</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 10 }}>No content yet</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>Go back to Settings and click Generate Content.</div>
                  <button onClick={() => setCurrentStep(2)} style={{ ...primaryBtn(false), width: 'auto', marginTop: 16, padding: '12px 24px' }}>← Back to Settings</button>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 4, borderBottom: `1.5px solid ${C.borderSoft}`, marginBottom: 14 }}>
                    {([['caption', 'Caption'], ['hashtags', 'Hashtags'], ['prompt', 'Image Prompt']] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setStudioTab(k)} style={{ padding: '11px 18px', fontSize: 13, fontWeight: 800, border: 'none', borderBottom: studioTab === k ? `2.5px solid ${C.primary}` : '2.5px solid transparent', background: 'none', color: studioTab === k ? C.primaryDark : C.faint, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
                    ))}
                  </div>
                  {studioTab === 'caption' && (
                    <div>
                      <div style={{ fontSize: 12, color: C.primaryDark, backgroundColor: '#F5F0FF', border: '1px solid #DDD6FE', padding: '10px 14px', borderRadius: 12, marginBottom: 12, fontWeight: 600 }}>✨ AI-generated suggestion — feel free to edit, improve, or regenerate.</div>
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
                      }} className="sp-s1-ta" style={{ width: '100%', boxSizing: 'border-box', minHeight: 240, padding: '18px 20px', border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 14, lineHeight: 1.85, color: C.ink, backgroundColor: '#fff', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11.5, color: C.muted, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span><b style={{ color: C.primaryDark }}>{p.charCount}</b> characters</span>
                        <span><b style={{ color: C.primaryDark }}>{p.wordCount}</b> words • ~{Math.max(1, Math.ceil(p.wordCount / 200))} min read</span>
                        <span>{sentences} sentences</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button onClick={() => { try { navigator.clipboard.writeText(p.content); setCopiedText(true); setTimeout(() => setCopiedText(false), 2000); } catch {} }} style={{ padding: '10px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${C.border}`, backgroundColor: copiedText ? '#ECFDF5' : '#fff', color: copiedText ? '#059669' : C.ink, cursor: 'pointer', fontFamily: 'inherit' }}>📋 {copiedText ? 'Copied ✓' : 'Copy Text'}</button>
                        <button onClick={() => setCurrentStep(2)} title="Change tone in Creative Settings" style={{ padding: '10px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, border: '1.5px solid #FDE68A', backgroundColor: '#FFFBEB', color: '#92400E', cursor: 'pointer', fontFamily: 'inherit' }}>💼 Tone: {p.tone}</button>
                      </div>
                    </div>
                  )}
                  {studioTab === 'hashtags' && (
                    <div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {activeTags.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>Hashtags appear here after generation.</span>}
                        {activeTags.map((t, i) => {
                          const tagText = '#' + String(t).replace(/^#+/, '');
                          const inCaption = p.content.includes(tagText);
                          return (
                            <button key={i} onClick={() => {
                              // WhatsApp is a no-hashtag channel: never inject tags into its caption.
                              if (p.activePreviewPlatform === 'whatsapp') return;
                              const v = inCaption
                                ? p.content.split(tagText).join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
                                : `${p.content.trim()} ${tagText}`.trim();
                              p.setContent(v);
                              if (p.activePreviewPlatform && p.platformContent[p.activePreviewPlatform]) {
                                p.setPlatformContent({
                                  ...p.platformContent,
                                  [p.activePreviewPlatform]: {
                                    ...p.platformContent[p.activePreviewPlatform],
                                    caption: v.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim(),
                                  },
                                });
                              }
                              try { navigator.clipboard.writeText(tagText); } catch {}
                            }} title={inCaption ? 'Click to remove from caption' : 'Click to add to caption'} style={{ fontSize: 12, fontWeight: 700, backgroundColor: inCaption ? C.primary : C.primarySoft, color: inCaption ? '#fff' : C.primaryDark, border: `1.5px solid ${inCaption ? C.primary : C.primaryBorder}`, padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', boxShadow: inCaption ? '0 3px 10px rgba(124,58,237,0.3)' : 'none' }}>{tagText}{inCaption ? ' ✓' : ''}</button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>Click a hashtag to add it to (or remove it from) your caption.</div>
                    </div>
                  )}
                  {studioTab === 'prompt' && (
                    <div>
                      <textarea value={p.imagePrompt} onChange={() => {}} placeholder="Image prompt appears here…" style={{ width: '100%', boxSizing: 'border-box', minHeight: 140, padding: '16px 18px', border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 13.5, lineHeight: 1.75, color: C.ink, backgroundColor: '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Powers Generate AI Image with your Image Style + Aspect Ratio.</div>
                    </div>
                  )}
                  <div style={{ ...card, borderRadius: 16, padding: '18px 20px', marginTop: 18, boxShadow: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, flex: 1 }}>Suggested Hashtags</div>
                      <button onClick={p.generateContent} disabled={!canGenContent} title={!canGenContent ? genContentBlocker : 'Refresh hashtags'} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 800, border: `1.5px solid ${canGenContent ? C.primaryBorder : C.border}`, backgroundColor: '#fff', color: canGenContent ? C.primaryDark : C.faint, cursor: canGenContent ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>↻ Refresh</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(activeTags.length ? activeTags.slice(0, 10) : ['innovation', 'collaboration', 'technology', 'future', 'growth', 'community', 'SocialPulse', 'digitaltransformation', 'teamwork', 'success']).map((t, i) => {
                        const tagText = '#' + String(t).replace(/^#+/, '');
                        const inCaption = activeTags.length > 0 && p.content.includes(tagText);
                        return (
                          <button key={i} disabled={activeTags.length === 0} onClick={() => {
                            // WhatsApp is a no-hashtag channel: never inject tags into its caption.
                            if (p.activePreviewPlatform === 'whatsapp') return;
                            const v = inCaption
                              ? p.content.split(tagText).join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
                              : `${p.content.trim()} ${tagText}`.trim();
                            p.setContent(v);
                            if (p.activePreviewPlatform && p.platformContent[p.activePreviewPlatform]) {
                              p.setPlatformContent({
                                ...p.platformContent,
                                [p.activePreviewPlatform]: {
                                  ...p.platformContent[p.activePreviewPlatform],
                                  caption: v.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim(),
                                },
                              });
                            }
                          }} title={activeTags.length === 0 ? 'Generate content to activate hashtags' : inCaption ? 'Click to remove from caption' : 'Click to add to caption'} style={{ fontSize: 12, fontWeight: 700, backgroundColor: inCaption ? C.primary : C.primarySoft, color: inCaption ? '#fff' : C.primaryDark, border: `1.5px solid ${inCaption ? C.primary : C.primaryBorder}`, padding: '7px 14px', borderRadius: 999, cursor: activeTags.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit', opacity: activeTags.length === 0 ? 0.75 : 1 }}>{tagText}{inCaption ? ' ✓' : ''}</button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}` }}>
                <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
                <div style={{ flex: 1 }} />
                <button onClick={goNext} disabled={!hasContent} title={!hasContent ? 'Generate content first' : 'Continue'} style={{ minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: hasContent ? 'pointer' : 'not-allowed', fontFamily: 'inherit', background: hasContent ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : '#DDD6FE', color: '#fff', boxShadow: hasContent ? '0 6px 22px rgba(124,58,237,0.42)' : 'none' }}>Next →</button>
              </div>
            </div>

            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ position: 'relative', borderRadius: 20, padding: '26px 22px 22px', background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <span style={{ position: 'absolute', top: 14, left: 16, width: 30, height: 30, borderRadius: '50%', background: '#0A66C2', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(10,102,194,0.35)' }}>in</span>
                <span style={{ position: 'absolute', top: 44, right: 14, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>📸</span>
                <span style={{ position: 'absolute', bottom: 72, left: 12, width: 30, height: 30, borderRadius: '50%', background: '#1877F2', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(24,119,242,0.35)' }}>f</span>
                <span style={{ position: 'absolute', bottom: 96, right: 18, width: 30, height: 30, borderRadius: '50%', background: '#25D366', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(37,211,102,0.35)' }}>💬</span>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto', boxShadow: '0 8px 24px rgba(124,58,237,0.22)', border: '1px solid #E9D5FF' }}>🤖</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginTop: 14, letterSpacing: '-0.01em', lineHeight: 1.4 }}>Turn Ideas Into<br />Impact!</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, fontWeight: 600 }}>Create. Engage. Grow.</div>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 12 }}>💡 AI Suggestions</div>
                {[
                  ['📝', 'Make it shorter', 'Try a more concise version.', '#EDE9FE'],
                  ['📣', 'Add a call-to-action', 'Encourage your audience to take action.', '#FFFBEB'],
                  ['✨', 'Make it more engaging', 'Add emojis or a personal touch.', '#FCE7F3'],
                ].map(([icon, title, desc, bg]) => (
                  <div key={title} className="sp-s2-opt" style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 14, border: `1px solid ${C.borderSoft}`, background: '#FCFCFE', marginBottom: 8 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{title}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>🎯 Content Tips</div>
                {['Keep it clear and concise', 'Include a strong call-to-action', 'Use relevant hashtags', 'Maintain your brand tone'].map(tip => (
                  <div key={tip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>{tip}</span>
                  </div>
                ))}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${C.border}`, textAlign: 'center', fontSize: 13, fontWeight: 800, color: C.primaryDark, fontStyle: 'italic', lineHeight: 1.5 }}>“Small Content,<br />Big Results”</div>
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 4 — MEDIA ================= */}
        {currentStep === 4 && (
          <div className="sp-s2-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🖼️</div>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Media Studio</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Step 4 of 8: Create or select visuals for your post</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.primaryDark, background: 'linear-gradient(135deg,#F5F0FF,#FCE7F3)', border: '1px solid #DDD6FE', padding: '6px 13px', borderRadius: 999, whiteSpace: 'nowrap' }}>✨ AI Media Ready</span>
                <button onClick={saveDraft} style={{ ...ghostBtn, minHeight: 38, fontSize: 12, padding: '10px 16px' }}>💾 Save Draft</button>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginTop: 20, marginBottom: 4 }}>Choose Your Media</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Pick how you want to add visuals — switch anytime, nothing is lost.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
                {[
                  ['ai', '✨', 'Generate with AI', 'Create a custom visual from your content'],
                  ['upload', '📁', 'Upload Media', 'Use your own image or video'],
                  ['library', '🖼️', 'Asset Gallery', 'Choose from your existing assets'],
                ].map(([k, i, t, d]) => {
                  const active = mediaTab === k;
                  return (
                    <button key={k} onClick={() => setMediaTab(k as 'ai' | 'upload' | 'library')} className="sp-s2-opt" style={selectCardPremium(active)}>
                      <span style={checkBadge(active)}>{active ? '✓' : ''}</span>
                      <span style={{ fontSize: 24 }}>{i}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: active ? C.primaryDark : C.ink }}>{t}</span>
                      <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{d}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {p.generationError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', borderRadius: 12 }}>
                <span style={{ flex: 1 }}>⚠️ {p.generationError}</span>
                <button onClick={() => p.setGenerationError('')} style={{ border: 'none', background: 'none', color: '#B91C1C', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '0 2px' }}>×</button>
              </div>
            )}
            {/* ---- AI image generation (featured panel) ---- */}
            {mediaTab === 'ai' && (
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Describe Your Visual</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>Tell AI what you want the image to look like.</div>
                {(() => {
                  const derived = p.content.trim().split('\n')[0].substring(0, 200) || p.prompt.trim();
                  const shown = useContentContext ? (p.imagePrompt || derived) : p.imagePrompt;
                  return (
                    <>
                      <textarea
                        ref={promptInputRef}
                        value={shown}
                        readOnly={useContentContext}
                        onChange={e => { setUseContentContext(false); p.setImagePrompt(e.target.value); }}
                        placeholder="e.g. A modern professional workspace with a laptop, creative lighting, and a futuristic technology feel…"
                        className="sp-s1-ta"
                        style={{ width: '100%', boxSizing: 'border-box', minHeight: 120, padding: '16px 18px', border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 13.5, lineHeight: 1.7, color: useContentContext && !p.imagePrompt ? C.muted : C.ink, backgroundColor: useContentContext ? '#F8FAFC' : '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, color: C.faint, fontWeight: 600 }}>{shown.length}/500</span>
                        <button
                          onClick={() => { if (useContentContext) { setUseContentContext(false); } else { setUseContentContext(true); p.setImagePrompt(''); } }}
                          title={useContentContext ? 'Write a custom prompt instead' : 'Use your post content as the prompt context'}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 800, border: `1.5px solid ${useContentContext ? C.primary : C.border}`, backgroundColor: useContentContext ? C.primarySoft : '#fff', color: useContentContext ? C.primaryDark : C.muted, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Use Content Context
                          <span style={{ width: 30, height: 17, borderRadius: 999, backgroundColor: useContentContext ? C.primary : '#CBD5E1', display: 'flex', alignItems: 'center', padding: '0 2px', justifyContent: useContentContext ? 'flex-end' : 'flex-start', transition: 'all 0.16s' }}>
                            <span style={{ width: 13, height: 13, borderRadius: '50%', backgroundColor: '#fff' }} />
                          </span>
                        </button>
                        <div style={{ flex: 1 }} />
                        <button onClick={p.generateImage} disabled={!canGenImage} title={!p.aspectRatio ? 'Choose aspect ratio in Settings first' : !p.content.trim() ? 'Add content first' : 'Generate AI image'} style={{ minHeight: 46, padding: '12px 28px', borderRadius: 12, fontSize: 13.5, fontWeight: 800, border: 'none', cursor: canGenImage ? 'pointer' : 'not-allowed', fontFamily: 'inherit', background: canGenImage ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : '#DDD6FE', color: '#fff', boxShadow: canGenImage ? '0 6px 20px rgba(124,58,237,0.4)' : 'none' }}>
                          {p.isGeneratingImage ? 'Generating…' : '✨ Generate Image'}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>AI will use your post topic, tone, and selected visual style from the previous step.{!p.aspectRatio ? ' Choose an aspect ratio in Settings to unlock generation.' : ''}</div>
                    </>
                  );
                })()}
              </div>
            )}
            {mediaTab === 'ai' && (
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 12 }}>Generated Media</div>
                {(() => {
                  const hasResult = !!(p.generatedImage || p.generatedVideo);
                  if (genGate) {
                    return (
                      <AiImageLoader
                        key={genRunId}
                        status={p.generationError ? 'error' : p.isGeneratingImage ? 'working' : 'ready'}
                        durationMs={14000}
                        onReveal={handleGenReveal}
                        aspect={p.aspectRatio}
                        onRetry={p.generateImage}
                        canRetry={canGenImage}
                      />
                    );
                  }
                  if (genFinishing && hasResult) {
                    return (
                      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.border}`, backgroundColor: '#000' }}>
                        <div className="sp-ai-arrive">
                          {p.generatedVideo
                            ? <video src={p.generatedVideo} controls style={{ width: '100%', maxHeight: 420, display: 'block', backgroundColor: '#000' }} />
                            : <img src={p.generatedImage} alt="AI generated visual" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block', backgroundColor: '#0F172A' }} />}
                        </div>
                        <AiImageLoader status="ready" finishing overlay />
                      </div>
                    );
                  }
                  if (hasResult) {
                    return (
                  <div>
                    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.border}`, backgroundColor: '#000' }}>
                      {p.generatedVideo
                        ? <video src={p.generatedVideo} controls style={{ width: '100%', maxHeight: 420, display: 'block', backgroundColor: '#000' }} />
                        : <img src={p.generatedImage} alt="AI generated visual" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block', backgroundColor: '#0F172A' }} />}
                      <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={p.generateImage} disabled={!canGenImage} title="Generate again with the current prompt" style={{ flex: 1, minWidth: 110, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(15,23,42,0.72)', color: '#fff', cursor: canGenImage ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: canGenImage ? 1 : 0.6 }}>↻ Regenerate</button>
                        <button onClick={() => {
                          if (useContentContext) {
                            setUseContentContext(false);
                            if (!p.imagePrompt) {
                              const derived = p.content.trim().split('\n')[0].substring(0, 200) || p.prompt.trim();
                              if (derived) p.setImagePrompt(derived);
                            }
                          }
                          promptInputRef.current?.focus();
                        }} title="Edit the prompt above" style={{ flex: 1, minWidth: 110, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.92)', color: '#0F172A', cursor: 'pointer', fontFamily: 'inherit' }}>✏️ Edit Prompt</button>
                        <button onClick={downloadGeneratedMedia} title="Download this file to your device" style={{ flex: 1, minWidth: 90, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.92)', color: '#0F172A', cursor: 'pointer', fontFamily: 'inherit' }}>📥 Download</button>
                        {!p.generatedVideo && (
                          <button onClick={() => p.clearGeneratedImage()} title="Remove the generated visual" style={{ flex: 1, minWidth: 90, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(220,38,38,0.85)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>🗑️ Remove</button>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {[
                        `Aspect Ratio: ${p.aspectRatio || '—'}${p.aspectRatio && p.aspectRatioMap[p.aspectRatio] ? ` (${p.aspectRatioMap[p.aspectRatio].label})` : ''}`,
                        `Style: ${p.imageStyle}`,
                        `Size: ${p.aspectRatio && p.aspectRatioMap[p.aspectRatio] ? `${p.aspectRatioMap[p.aspectRatio].width}×${p.aspectRatioMap[p.aspectRatio].height}` : '—'}`,
                      ].map(d => (
                        <span key={d} style={{ fontSize: 11, fontWeight: 700, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '5px 12px', borderRadius: 999 }}>{d}</span>
                      ))}
                    </div>
                  </div>
                    );
                  }
                  // Failed with nothing to show → show generation error.
                  if (p.generationError) {
                    return <div style={{ border: '1.5px solid #FECACA', borderRadius: 16, backgroundColor: '#FEF2F2', padding: 16, fontSize: 12, color: '#B91C1C', fontWeight: 600 }}>⚠️ {p.generationError}</div>;
                  }
                  return (
                  <div style={{ border: '2px dashed #C4B5FD', borderRadius: 16, backgroundColor: '#FAF8FF', padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: 34 }}>✨</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 10 }}>Your AI-generated visual will appear here</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Describe your visual above and click Generate Image.</div>
                  </div>
                  );
                })()}
              </div>
            )}
            {/* ---- Upload your own media (featured panel) ---- */}
            {mediaTab === 'upload' && (
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Upload your own media</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Your files land in Recent Media below — JPG, PNG, MP4, MOV.</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: p.mediaItems.length >= 9 ? '#B45309' : C.muted, backgroundColor: p.mediaItems.length >= 9 ? '#FFFBEB' : '#F1F3F9', border: `1px solid ${p.mediaItems.length >= 9 ? '#FDE68A' : C.border}` }}>
                    {p.mediaItems.length}/9 files
                  </span>
                </div>
                <div
                  onClick={() => p.fileInputRef.current?.click()}
                  onDragOver={p.handleDragOver}
                  onDragEnter={e => { e.preventDefault(); p.setDragOverPreview(true); }}
                  onDragLeave={e => { e.preventDefault(); p.setDragOverPreview(false); }}
                  onDrop={p.handleDrop}
                  className="sp-s1-drop"
                  style={{ borderRadius: 16, border: p.dragOverPreview ? `2px dashed ${C.primary}` : '2px dashed #C4B5FD', backgroundColor: p.dragOverPreview ? '#EDE9FE' : '#F5F1FF', padding: '32px 20px', marginTop: 14, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                >
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fff', border: '1px solid #E8EAF1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, boxShadow: '0 4px 14px rgba(124,58,237,0.12)' }}>☁️</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 10 }}>Drag & drop images or videos here</div>
                  <div style={{ fontSize: 12.5, color: C.primaryDark, fontWeight: 700 }}>or <span style={{ textDecoration: 'underline' }}>Browse Files</span></div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>JPG, PNG, WEBP, MP4 • Max 10MB</div>
                </div>
                <button onClick={() => p.fileInputRef.current?.click()} style={{ ...ghostBtn, width: '100%', marginTop: 10 }}>📤 Upload Media</button>
                {(() => {
                  const uploads = p.mediaItems.filter(m => mediaSource(m) === 'upload');
                  if (!uploads.length) return <div style={{ fontSize: 12, color: C.faint, marginTop: 12, textAlign: 'center' }}>No uploads yet — your files will appear here.</div>;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                      {uploads.map(m => (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, backgroundColor: '#fff' }}>
                          <span style={{ width: 52, height: 52, borderRadius: 9, overflow: 'hidden', backgroundColor: '#000', flexShrink: 0, display: 'block' }}>
                            {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} muted /> : <img src={m.url} alt={m.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mediaFileName(m)}</span>
                            <span style={{ display: 'block', fontSize: 11, color: C.faint, marginTop: 2 }}>{m.type === 'video' ? 'Video' : 'Image'}<MediaDims url={m.url} type={m.type} /></span>
                          </span>
                          <button onClick={() => p.removeMediaItem(m.id)} title="Remove file" style={{ padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Remove</button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ---- Recent Media gallery (Asset Gallery tab) ---- */}
            {/* Same items, same handlers (upload/generate/Canva/carousel all
                feed mediaItems) — this is a presentation layer over the
                existing gallery: select, filter, reorder, per-item menu. */}
            {mediaTab === 'library' && (
            <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Asset Gallery</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 4 }}>Choose from your existing assets.</div>
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
            )}
            <input ref={p.fileInputRef} type="file" accept="image/*,video/*" multiple onChange={p.handleUploadImage} style={{ display: 'none' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}`, flexWrap: 'wrap' }}>
              <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setCurrentStep(7)} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14, width: 'auto' }}>Preview</button>
              <button onClick={goNext} style={{ minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Next →</button>
            </div>
            </div>
            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ position: 'relative', borderRadius: 20, padding: '26px 22px 22px', background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <span style={{ position: 'absolute', top: 14, left: 16, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>📸</span>
                <span style={{ position: 'absolute', top: 44, right: 14, width: 30, height: 30, borderRadius: '50%', background: '#EDE9FE', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(124,58,237,0.2)' }}>✨</span>
                <span style={{ position: 'absolute', bottom: 84, left: 12, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>🎨</span>
                <span style={{ position: 'absolute', bottom: 108, right: 18, width: 30, height: 30, borderRadius: '50%', background: '#EDE9FE', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(124,58,237,0.2)' }}>🖼️</span>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto', boxShadow: '0 8px 24px rgba(124,58,237,0.22)', border: '1px solid #E9D5FF' }}>🤖</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginTop: 14, letterSpacing: '-0.01em', lineHeight: 1.4 }}>Bring Your Ideas<br />To Life ✨</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, lineHeight: 1.65 }}>AI creates visuals that match your content, tone, and brand.</div>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 12 }}>🎨 Current Style</div>
                {[
                  ['Tone', p.tone || 'Not set'],
                  ['Image Style', p.imageStyle || 'Not set'],
                  ['Aspect Ratio', p.aspectRatio ? `${p.aspectRatio}${p.aspectRatioMap[p.aspectRatio] ? ` ${p.aspectRatioMap[p.aspectRatio].label}` : ''}` : 'Not set'],
                ].map(([label, value]) => (
                  <div key={label} style={{ border: `1px solid ${C.borderSoft}`, background: '#FCFCFE', borderRadius: 12, padding: '9px 12px', marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.primaryDark, marginTop: 2 }}>{value}</div>
                  </div>
                ))}
                <button onClick={() => setCurrentStep(2)} style={{ width: '100%', marginTop: 4, padding: '10px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer', fontFamily: 'inherit' }}>Change Settings →</button>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>💡 Visual Tips</div>
                {['Keep visuals relevant to your message', 'Use high-quality images', 'Match visuals with your brand', 'Choose the right aspect ratio', 'Avoid overcrowded designs'].map(tip => (
                  <div key={tip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>{tip}</span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 5 — DESIGN ================= */}
        {currentStep === 5 && (
          <div className="sp-s2-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🎨</div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Design & Branding Studio</div>
                    <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Step 5 of 8: Design your visuals, apply your brand, and prepare your post</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F5F0FF', border: '1px solid #DDD6FE', borderRadius: 14, padding: '12px 16px', marginTop: 18 }}>
                  <span style={{ fontSize: 16, lineHeight: 1.4 }}>✨</span>
                  <span style={{ fontSize: 12.5, color: C.primaryDark, fontWeight: 600, lineHeight: 1.6 }}>Make your content visually consistent before publishing.</span>
                </div>
              </div>

              {/* ---- Section 1: Design with Canva ---- */}
              {/* Edit/Create opens the Canva editor in a NEW TAB (this tab is
                  never navigated away). Import brings the edited result back
                  into the same gallery pipeline - repeat imports of the same
                  design update the linked item in place, never duplicating. */}
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Design with Canva</span>
                      {p.canvaConnected ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0' }}>Canva Connected ✓{p.canvaName ? ` as ${p.canvaName}` : ''}</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: C.muted, backgroundColor: '#fff', border: `1px solid ${C.border}` }}>Not connected</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6, marginTop: 6 }}>Create or edit a design in Canva, then import it directly into your SocialPulse gallery.</div>
                    {!p.canvaConnected ? (
                      <button onClick={() => p.openInCanva()} style={{ marginTop: 14, minHeight: 48, padding: '13px 30px', borderRadius: 12, fontSize: 14, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 20px rgba(124,58,237,0.4)' }}>Connect Canva →</button>
                    ) : (
                      <button onClick={() => p.openInCanva()} disabled={p.isSendingToCanva} title="Open Canva" style={{ marginTop: 14, minHeight: 48, padding: '13px 30px', borderRadius: 12, fontSize: 14, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: p.isSendingToCanva ? 'wait' : 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 20px rgba(124,58,237,0.4)', opacity: p.isSendingToCanva ? 0.7 : 1 }}>{p.isSendingToCanva ? 'Opening…' : 'Open Canva →'}</button>
                    )}
                  </div>
                  <div style={{ flex: '0 1 190px', minWidth: 150, borderRadius: 16, background: 'linear-gradient(135deg,#E0F7FA,#EDE9FE)', border: '1px solid #C4B5FD', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 150, overflow: 'hidden' }}>
                    <span style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#00C4CC,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 32, fontStyle: 'italic', fontFamily: 'Georgia, serif', boxShadow: '0 8px 24px rgba(124,58,237,0.3)' }}>C</span>
                    <span style={{ position: 'absolute', top: 12, left: 14, fontSize: 18 }}>🎨</span>
                    <span style={{ position: 'absolute', top: 16, right: 16, fontSize: 18 }}>🖼️</span>
                    <span style={{ position: 'absolute', bottom: 14, left: 20, fontSize: 16 }}>✨</span>
                    <span style={{ position: 'absolute', bottom: 18, right: 22, fontSize: 16 }}>🖌️</span>
                  </div>
                </div>
                {p.canvaConnected && (
                  <div style={{ marginTop: 16 }}>
                    {p.canvaSession && !p.canvaReadyId && !p.isImportingFromCanva && (
                      <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, backgroundColor: '#F6F1FF', border: `1px solid ${C.primaryBorder}`, fontSize: 12.5, color: C.primaryDark, lineHeight: 1.6 }}>🎨 Your Canva editor is open in another tab. When you finish editing, return here and import the latest version.</div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
                      <button
                        onClick={p.createInCanva}
                        disabled={p.isCreatingInCanva}
                        title="Start a blank design in Canva and build it with Canva's own tools"
                        style={{ textAlign: 'left', padding: 14, borderRadius: 14, border: `1px solid ${C.border}`, backgroundColor: '#fff', cursor: p.isCreatingInCanva ? 'wait' : 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}
                      >
                        <div style={{ fontSize: 18 }}>➕</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginTop: 6 }}>{p.isCreatingInCanva ? 'Creating…' : 'Create in Canva'}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>Start a new design from scratch</div>
                      </button>
                      <button
                        onClick={() => { if (canvaEditTarget) p.openInCanva(canvaEditTarget.url); }}
                        disabled={p.isSendingToCanva || !canvaEditTarget}
                        title={!canvaEditTarget ? (selectedMedia ? 'Select an image (not a video) to edit' : 'Generate or upload an image first') : `Open “${mediaFileName(canvaEditTarget)}” in Canva`}
                        style={{ textAlign: 'left', padding: 14, borderRadius: 14, border: `1px solid ${!canvaEditTarget ? C.border : C.primaryBorder}`, backgroundColor: canvaEditTarget ? '#F6F1FF' : '#fff', cursor: (!canvaEditTarget || p.isSendingToCanva) ? 'not-allowed' : 'pointer', opacity: (!canvaEditTarget || p.isSendingToCanva) ? 0.55 : 1, fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}
                      >
                        <div style={{ fontSize: 18 }}>🖼️</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginTop: 6 }}>{p.isSendingToCanva ? 'Opening…' : 'Edit Selected in Canva'}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canvaEditTarget ? `✦ ${mediaFileName(canvaEditTarget)}` : 'Select an image below'}</div>
                      </button>
                      <button
                        onClick={p.importFromCanva}
                        disabled={!p.canvaReadyId || p.isImportingFromCanva}
                        title={p.canvaReadyId ? 'Bring your edited design back as a new gallery item' : 'Finish editing in Canva first'}
                        style={{ textAlign: 'left', padding: 14, borderRadius: 14, border: `1px solid ${p.canvaReadyId ? C.primaryBorder : C.border}`, backgroundColor: p.canvaReadyId ? C.primarySoft : '#fff', cursor: (!p.canvaReadyId || p.isImportingFromCanva) ? 'not-allowed' : 'pointer', opacity: (!p.canvaReadyId || p.isImportingFromCanva) ? 0.6 : 1, fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}
                      >
                        <div style={{ fontSize: 18 }}>{p.isImportingFromCanva ? '⏳' : '📥'}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: p.canvaReadyId ? C.primaryDark : C.ink, marginTop: 6 }}>{p.isImportingFromCanva ? 'Importing…' : 'Import from Canva'}{p.canvaReadyId && !p.isImportingFromCanva ? ' ●' : ''}</div>
                        <div style={{ fontSize: 11, color: p.canvaReadyId ? C.primaryDark : C.muted, marginTop: 2, lineHeight: 1.5 }}>{p.canvaReadyId ? 'Your edited design is ready — bring it in' : 'Finish editing in Canva first'}</div>
                      </button>
                    </div>
                    <button onClick={p.disconnectCanva} style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Disconnect Canva</button>
                  </div>
                )}
              </div>

              {/* ---- Section 2: Post Format ---- */}
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Post Format</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>Choose how your visual content will be published.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                  <button onClick={() => p.setIsCarousel(false)} className="sp-s2-opt" style={selectCardPremium(!p.isCarousel)}>
                    <span style={checkBadge(!p.isCarousel)}>{!p.isCarousel ? '✓' : ''}</span>
                    <span style={{ fontSize: 24 }}>🖼️</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: !p.isCarousel ? C.primaryDark : C.ink }}>Single Post</span>
                    <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Publish one hero visual</span>
                  </button>
                  <button onClick={() => p.setIsCarousel(true)} className="sp-s2-opt" style={selectCardPremium(p.isCarousel)}>
                    <span style={checkBadge(p.isCarousel)}>{p.isCarousel ? '✓' : ''}</span>
                    <span style={{ fontSize: 24 }}>🎠</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: p.isCarousel ? C.primaryDark : C.ink }}>Carousel{p.isCarousel ? ` · ${p.carouselSlides.length}` : ''}</span>
                    <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Combine 2–9 images into one swipeable post</span>
                  </button>
                </div>
                {p.isCarousel && <div style={{ fontSize: 12, color: C.primaryDark, fontWeight: 700, marginTop: 10 }}>Carousel supports 2–9 images.</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>Supported on:</span>
                  {(['LinkedIn', 'Facebook', 'Instagram'] as const).map(pl => (
                    <span key={pl} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: C.ink, backgroundColor: '#F8FAFC', border: `1px solid ${C.borderSoft}`, padding: '4px 11px', borderRadius: 999 }}>
                      <span style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: p.platformColors[pl.toLowerCase()] || C.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 8 }}>●</span>
                      {pl}
                    </span>
                  ))}
                </div>
                {!p.isCarousel ? (
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginTop: 12 }}>One post, one hero visual — switch to Carousel to bundle slides into a swipeable album.</div>
                ) : (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>Swipe order = numbered order. Image-only (videos can&apos;t join a carousel). Drag slides to reorder.</div>
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
                        <button onClick={() => setShowSlidePicker(v => !v)} title="Add slides from your media" style={{ flex: '0 0 112px', aspectRatio: '1', borderRadius: 12, border: '1.5px dashed #CBD5E1', backgroundColor: '#FCFCFE', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: C.primaryDark, fontFamily: 'inherit' }}>
                          <span style={{ fontSize: 20, fontWeight: 800 }}>＋</span>
                          <span style={{ fontSize: 10, fontWeight: 700 }}>Add Slide</span>
                        </button>
                      </div>
                    ) : (
                      <div style={{ border: '1.5px dashed #CBD5E1', borderRadius: 12, backgroundColor: '#FCFCFE', padding: 18, textAlign: 'center', color: C.faint, fontSize: 12 }}>No slides yet — add images from your media or generate slides with AI.</div>
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
                      if (!addable.length) return <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Every image is already a slide — create more in Media (Step 4).</div>;
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}`, flexWrap: 'wrap' }}>
                <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setCurrentStep(7)} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14, width: 'auto' }}>Preview</button>
                <button onClick={goNext} style={{ minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Next →</button>
              </div>
            </div>
            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ position: 'relative', borderRadius: 20, padding: '26px 22px 22px', background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <span style={{ position: 'absolute', top: 14, left: 16, width: 30, height: 30, borderRadius: 10, background: 'linear-gradient(135deg,#00C4CC,#7C3AED)', color: '#fff', fontSize: 14, fontWeight: 800, fontStyle: 'italic', fontFamily: 'Georgia, serif', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(124,58,237,0.3)' }}>C</span>
                <span style={{ position: 'absolute', top: 44, right: 14, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>🖼️</span>
                <span style={{ position: 'absolute', bottom: 84, left: 12, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>🎨</span>
                <span style={{ position: 'absolute', bottom: 108, right: 18, width: 30, height: 30, borderRadius: '50%', background: '#EDE9FE', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(124,58,237,0.2)' }}>✨</span>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto', boxShadow: '0 8px 24px rgba(124,58,237,0.22)', border: '1px solid #E9D5FF' }}>🤖</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginTop: 14, letterSpacing: '-0.01em', lineHeight: 1.4 }}>Create Beautiful<br />Visuals That Stand Out ✨</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, fontWeight: 600 }}>Design. Brand. Publish.</div>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>💡 Design Tips</div>
                {['Keep your branding consistent', 'Use readable fonts', 'Maintain good color contrast', 'Choose high-quality visuals', 'Preview before publishing'].map(tip => (
                  <div key={tip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>{tip}</span>
                  </div>
                ))}
              </div>

            </aside>
          </div>
        )}

        {/* ================= STEP 6 — BRANDING & ACCESSIBILITY ================= */}
        {currentStep === 6 && (
          <div className="sp-s2-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🎨</div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Branding & Accessibility</div>
                    <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Step 6 of 8: Apply your brand identity and make your visuals accessible</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F5F0FF', border: '1px solid #DDD6FE', borderRadius: 14, padding: '12px 16px', marginTop: 18 }}>
                  <span style={{ fontSize: 16, lineHeight: 1.4 }}>✨</span>
                  <span style={{ fontSize: 12.5, color: C.primaryDark, fontWeight: 600, lineHeight: 1.6 }}>Consistent branding creates recognition, while accessible visuals make your content easier for everyone to understand.</span>
                </div>
              </div>

              {/* ---- Section 1: Brand Identity ---- */}
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Brand Identity</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Keep your visuals consistent with your brand identity across every platform.</div>
                  </div>
                  <button
                    onClick={() => p.applyLogoToAllMedia()}
                    disabled={p.isApplyingLogo || !p.logoImage}
                    title={!p.logoImage ? 'Upload a brand logo first' : 'Burn the logo into all gallery media'}
                    style={{ minHeight: 44, padding: '12px 22px', borderRadius: 12, fontSize: 12.5, fontWeight: 800, border: 'none', cursor: (p.isApplyingLogo || !p.logoImage) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', background: (p.isApplyingLogo || !p.logoImage) ? '#DDD6FE' : 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: (p.isApplyingLogo || !p.logoImage) ? 'none' : '0 6px 20px rgba(124,58,237,0.4)' }}
                  >
                    {p.isApplyingLogo ? 'Applying…' : 'Apply to All Slides'}
                  </button>
                </div>
                <div className="sp-wiz-grid3" style={{ marginTop: 12 }}>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Logo</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {p.logoImage
                        ? <img src={p.logoImage} alt="Brand logo" style={{ width: 44, height: 44, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 10, border: `1px solid ${C.border}`, padding: 4 }} />
                        : <span style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15 }}>SP</span>}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>SocialPulse</div>
                        <div style={{ fontSize: 10, color: p.logoImage ? '#059669' : C.faint, fontWeight: 600 }}>{p.logoImage ? `✓ Logo uploaded • ${p.logoPosition} • ${Math.round(p.logoScale * 100)}%` : 'No logo uploaded yet'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                      <button onClick={() => p.setLogoModalOpen(true)} style={{ flex: 1, padding: '10px', borderRadius: 9, fontSize: 12, fontWeight: 800, border: `1.5px dashed ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer', fontFamily: 'inherit' }}>{p.logoImage ? 'Change Logo' : 'Upload Logo'}</button>
                      {p.logoImage && <button onClick={p.clearLogo} title="Remove the brand logo" style={{ flex: 1, padding: '8px 10px', borderRadius: 9, fontSize: 11, fontWeight: 700, border: '1px solid #FECACA', backgroundColor: '#fff', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>}
                    </div>
                  </div>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Colors</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Manage your brand color palette.</div>
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
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Fonts</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Keep your typography consistent.</div>
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
                {(() => {
                  const burnedCount = p.mediaItems.filter(m => p.burnedLogoIds[m.id]).length;
                  if (!burnedCount) return null;
                  return (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '9px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ flex: '1 1 200px', lineHeight: 1.5 }}>⚠️ Logo is baked into {burnedCount} image{burnedCount === 1 ? '' : 's'} from a previous Apply — removing the brand logo won’t erase those pixels.</span>
                      <button onClick={() => p.restoreBurnedMedia()} title="Swap burned images back to their pre-logo originals" style={{ padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 800, border: '1px solid #F59E0B', backgroundColor: '#fff', color: '#92400E', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Restore originals</button>
                    </div>
                  );
                })()}
              </div>

              {/* ---- Section 2: Brand Readiness ---- */}
              <div style={{ ...card, borderRadius: 20, padding: '20px 24px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Brand Readiness</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 6 }}>Setup status at a glance — complete each item before Preview.</div>
                {[
                  ['Logo', p.logoImage ? 'Uploaded ✓' : '⚠ Not uploaded', !!p.logoImage],
                  ['Colors', `${brandSwatches.length} colors configured`, brandSwatches.length >= 4],
                  ['Fonts', `${headingFont} + ${bodyFont}`, !!(headingFont && bodyFont)],
                  ['Branding', p.logoImage ? 'Ready to apply ✓' : 'Add a logo to apply', !!p.logoImage],
                ].map(([label, value, ok]) => (
                  <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                    <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, flex: 1 }}>{label}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: ok ? '#059669' : '#92400E', backgroundColor: ok ? '#ECFDF5' : '#FFFBEB', border: `1px solid ${ok ? '#A7F3D0' : '#FDE68A'}`, padding: '4px 12px', borderRadius: 999 }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* ---- Section 3: Design Preview (branding preview) ---- */}
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Design Preview</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>See how your brand identity looks on your selected visual.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Preview for</span>
                  <select value={previewPlatform} onChange={e => setPreviewPlatform(e.target.value)} style={{ padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', textTransform: 'capitalize' }}>
                    {['linkedin', 'facebook', 'instagram', 'whatsapp'].map(pl => <option key={pl} value={pl} style={{ textTransform: 'capitalize' }}>{pl.charAt(0).toUpperCase() + pl.slice(1)}</option>)}
                  </select>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '5px 12px', borderRadius: 999 }}>{p.aspectRatio ? `${p.aspectRatio}${p.aspectRatioMap[p.aspectRatio] ? ` • ${p.aspectRatioMap[p.aspectRatio].label}` : ''}` : 'No aspect ratio'}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '5px 12px', borderRadius: 999 }}>{p.imageStyle}</span>
                </div>
                {(() => {
                  const hero = canvaEditTarget || p.mediaItems.find(m => m.type === 'image') || p.mediaItems[0] || null;
                  const heroUrl = hero?.url || p.generatedImage || p.generatedVideo || '';
                  const heroIsVideo = hero ? hero.type === 'video' : !!p.generatedVideo && !hero;
                  const heroKey = hero?.id || 'gen';
                  const thumbs = (p.isCarousel ? p.carouselSlides : p.mediaItems).slice(0, 8);
                  if (!heroUrl) {
                    return <div style={{ border: '2px dashed #C4B5FD', borderRadius: 16, backgroundColor: '#FAF8FF', padding: 40, textAlign: 'center' }}>
                      <div style={{ fontSize: 32 }}>🖼️</div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginTop: 8 }}>No visual yet</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Create one in Media (Step 4), then return here.</div>
                    </div>;
                  }
                  return (
                    <div>
                      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.border}`, backgroundColor: '#000' }}>
                        {heroIsVideo
                          ? <video src={heroUrl} controls style={{ width: '100%', maxHeight: 380, display: 'block', backgroundColor: '#000' }} />
                          : <img src={heroUrl} alt={hero?.altText || 'Branded design preview'} style={{ width: '100%', maxHeight: 380, objectFit: 'contain', display: 'block', backgroundColor: '#0F172A' }} />}
                        {p.logoImage && !p.burnedLogoIds[heroKey] && !heroIsVideo && (
                          <img src={p.logoImage} alt="logo" style={{
                            position: 'absolute', width: `${Math.round(p.logoScale * 100)}%`, maxWidth: '28%', opacity: p.logoOpacity,
                            ...(p.logoPosition === 'top-left' ? { top: 10, left: 10 } : p.logoPosition === 'top-right' ? { top: 10, right: 10 } : p.logoPosition === 'bottom-left' ? { bottom: 54, left: 10 } : p.logoPosition === 'bottom-right' ? { bottom: 54, right: 10 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                            backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6,
                          }} />
                        )}
                        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => { if (heroUrl && !heroIsVideo) p.openInCanva(heroUrl); }}
                            disabled={!heroUrl || heroIsVideo || p.isSendingToCanva}
                            title="Edit this visual in Canva"
                            style={{ flex: 1, minWidth: 80, padding: '9px 10px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.92)', color: '#0F172A', cursor: (!heroUrl || heroIsVideo || p.isSendingToCanva) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!heroUrl || heroIsVideo || p.isSendingToCanva) ? 0.65 : 1 }}
                          >{p.isSendingToCanva ? 'Opening…' : '✏️ Edit'}</button>
                          {hero && (
                            <button
                              onClick={() => p.setMediaCover(hero.id)}
                              title="Make this the cover visual"
                              style={{ flex: 1, minWidth: 80, padding: '9px 10px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.92)', color: '#0F172A', cursor: 'pointer', fontFamily: 'inherit' }}
                            >🖼️ Cover</button>
                          )}
                          <button
                            onClick={() => p.applyLogoToAllMedia()}
                            disabled={p.isApplyingLogo || !p.logoImage}
                            title={!p.logoImage ? 'Upload a brand logo first' : 'Burn the logo into all gallery media'}
                            style={{ flex: 1, minWidth: 100, padding: '9px 10px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(124,58,237,0.92)', color: '#fff', cursor: (p.isApplyingLogo || !p.logoImage) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (p.isApplyingLogo || !p.logoImage) ? 0.65 : 1 }}
                          >{p.isApplyingLogo ? 'Applying…' : '🏷️ Apply to All'}</button>
                          {hero ? (
                            <button
                              onClick={() => { p.removeMediaItem(hero.id); if (selectedMediaId === hero.id) setSelectedMediaId(null); }}
                              title="Remove this visual"
                              style={{ flex: 1, minWidth: 80, padding: '9px 10px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(220,38,38,0.85)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                            >🗑️ Delete</button>
                          ) : (
                            <button
                              onClick={() => p.clearGeneratedImage()}
                              title="Remove the generated visual"
                              style={{ flex: 1, minWidth: 80, padding: '9px 10px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(220,38,38,0.85)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                            >🗑️ Delete</button>
                          )}
                        </div>
                      </div>
                      {p.isCarousel && thumbs.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', padding: '2px 2px 4px' }}>
                          {thumbs.map((m, i) => {
                            const selected = selectedMediaId === m.id || canvaEditTarget?.url === m.url;
                            return (
                              <button key={m.id} draggable
                                onClick={() => setSelectedMediaId(m.id)}
                                onDragStart={() => setDragSlideId(m.id)}
                                onDragOver={e => { e.preventDefault(); if (dragSlideId && dragSlideId !== m.id) setDragOverSlideId(m.id); }}
                                onDrop={() => { if (dragSlideId) p.reorderCarouselSlide(dragSlideId, m.id); setDragSlideId(null); setDragOverSlideId(null); }}
                                onDragEnd={() => { setDragSlideId(null); setDragOverSlideId(null); }}
                                title={`Slide ${i + 1} — click to feature, drag to reorder`}
                                style={{ flex: '0 0 72px', width: 72, height: 72, borderRadius: 10, overflow: 'hidden', border: dragOverSlideId === m.id ? `2px solid ${C.primary}` : selected ? `2px solid ${C.primary}` : `1px solid ${C.border}`, padding: 0, cursor: 'grab', backgroundColor: '#000', position: 'relative', boxShadow: selected ? '0 3px 10px rgba(124,58,237,0.3)' : 'none', opacity: dragSlideId === m.id ? 0.5 : 1 }}>
                                {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} muted /> : <img src={m.url} alt={m.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
                                <span style={{ position: 'absolute', top: 3, left: 3, minWidth: 18, height: 18, borderRadius: 999, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, padding: '0 4px' }}>{i + 1}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {!p.isCarousel && thumbs.length > 1 && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', padding: '2px 2px 4px' }}>
                          {thumbs.map(m => {
                            const selected = selectedMediaId === m.id || canvaEditTarget?.url === m.url;
                            return (
                              <button key={m.id} onClick={() => setSelectedMediaId(m.id)} title={`Feature “${mediaFileName(m)}”`} style={{ flex: '0 0 72px', width: 72, height: 72, borderRadius: 10, overflow: 'hidden', border: selected ? `2px solid ${C.primary}` : `1px solid ${C.border}`, padding: 0, cursor: 'pointer', backgroundColor: '#000', position: 'relative', boxShadow: selected ? '0 3px 10px rgba(124,58,237,0.3)' : 'none' }}>
                                {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} muted /> : <img src={m.url} alt={m.altText || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* ---- Section 4: Image ALT Text ---- */}
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Image ALT Text</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Add descriptions to your images to improve accessibility.</div>
                {altTextControls}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}`, flexWrap: 'wrap' }}>
                <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setCurrentStep(7)} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14, width: 'auto' }}>Preview</button>
                <button onClick={goNext} style={{ minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Next →</button>
              </div>
            </div>
            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ position: 'relative', borderRadius: 20, padding: '26px 22px 22px', background: 'linear-gradient(135deg,#EDE9FE 0%,#DDD6FE 100%)', border: '1px solid #C4B5FD', overflow: 'hidden', textAlign: 'center' }}>
                <span style={{ position: 'absolute', top: 14, left: 16, width: 32, height: 32, borderRadius: 10, background: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>SP</span>
                <span style={{ position: 'absolute', top: 44, right: 14, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>🎨</span>
                <span style={{ position: 'absolute', bottom: 84, left: 12, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>Aa</span>
                <span style={{ position: 'absolute', bottom: 108, right: 18, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>🖼️</span>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto', boxShadow: '0 8px 24px rgba(124,58,237,0.22)', border: '1px solid #E9D5FF' }}>🤖</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginTop: 14, letterSpacing: '-0.01em', lineHeight: 1.4 }}>Build a Stronger<br />Brand with AI ✨</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, fontWeight: 600, lineHeight: 1.6 }}>Consistent visuals create recognition and make your content easier to remember.</div>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>💡 Quick Tips</div>
                {['Use a recognizable logo', 'Keep brand colors consistent', 'Choose readable fonts', 'Maintain strong contrast', 'Add ALT text to images', 'Apply branding across slides'].map(tip => (
                  <div key={tip} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>{tip}</span>
                  </div>
                ))}
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '20px 22px', textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Brand Readiness</div>
                {(() => {
                  const imagesForAlt = [...p.mediaItems, ...postExtraImages].filter(m => m.type === 'image');
                  const altOk = imagesForAlt.length > 0 && imagesForAlt.every(m => m.altText?.trim());
                  const rows: Array<[string, boolean]> = [
                    ['Logo', !!p.logoImage],
                    ['Colors', brandSwatches.length >= 4],
                    ['Fonts', !!(headingFont && bodyFont)],
                    ['Accessibility', altOk],
                  ];
                  const score = rows.filter(([, ok]) => ok).length * 25;
                  const R = 34;
                  const CIRC = 2 * Math.PI * R;
                  return (
                    <>
                      <div style={{ position: 'relative', width: 96, height: 96, margin: '12px auto 4px' }}>
                        <svg width="96" height="96" viewBox="0 0 96 96">
                          <circle cx="48" cy="48" r={R} fill="none" stroke="#F1F3F9" strokeWidth="10" />
                          <circle cx="48" cy="48" r={R} fill="none" stroke="url(#brandScoreGrad)" strokeWidth="10" strokeLinecap="round"
                            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - score / 100)} transform="rotate(-90 48 48)"
                            style={{ transition: 'stroke-dashoffset 0.4s' }} />
                          <defs>
                            <linearGradient id="brandScoreGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#7C3AED" />
                              <stop offset="100%" stopColor="#A855F7" />
                            </linearGradient>
                          </defs>
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 800, color: C.ink }}>{score}%</div>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Setup status — not a quality score.</div>
                      {rows.map(([label, ok]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                          <span style={{ width: 17, height: 17, borderRadius: '50%', background: ok ? '#ECFDF5' : '#F1F3F9', border: `1px solid ${ok ? '#A7F3D0' : '#E2E8F0'}`, color: ok ? '#059669' : '#B6BDCC', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{ok ? '✓' : '·'}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: ok ? '#334155' : C.faint }}>{label}</span>
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>

              <div style={{ borderRadius: 20, padding: '24px 22px', background: 'linear-gradient(135deg,#F5F0FF,#EDE9FE)', border: '1px solid #DDD6FE', textAlign: 'center' }}>
                <div style={{ fontSize: 26, color: C.primary, fontWeight: 800, lineHeight: 1, fontFamily: 'Georgia, serif' }}>“</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.primaryDark, lineHeight: 1.55, letterSpacing: '-0.01em' }}>Consistency today,<br />stronger connections tomorrow.</div>
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 7 — PREVIEW ================= */}
        {currentStep === 7 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👁️</div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Review & Publish</div>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Take a final look at your content and settings before publishing.</div>
              </div>
            </div>
            <div className="sp-step7-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={{ ...card, borderRadius: 20, padding: '20px 22px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }} className="sp-ord-select">
              <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Selected Platform</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Choose where you want to publish this content.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['linkedin', 'facebook', 'instagram', 'whatsapp'] as const).filter(pl => p.selectedPlatforms.includes(pl)).map(pl => {
                  const active = previewPlatform === pl;
                  const brand = p.platformColors[pl] || '#0A66C2';
                  return (
                    <button key={pl} onClick={() => { setPreviewPlatform(pl); if (p.platformContent[pl]) p.switchPreviewPlatform(pl); }} className="sp-s2-opt" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, textTransform: 'capitalize', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? '#F5F0FF' : '#fff', color: active ? C.primaryDark : C.muted, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <p.PlatformIcon platform={pl} size={10} />
                      </span>
                      {pl}
                    </button>
                  );
                })}
                {p.selectedPlatforms.length === 0 && (
                  <div style={{ fontSize: 12.5, color: C.muted }}>No platforms selected yet — <button onClick={() => setCurrentStep(2)} style={{ background: 'none', border: 'none', padding: 0, color: C.primaryDark, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5 }}>pick platforms in Settings →</button></div>
                )}
                {p.selectedPlatforms.length > 0 && (
                  <button ref={previewBtnRef} onClick={openPostPreview} title="Open the realistic platform preview in a popup" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}>👁 {p.selectedPlatforms.length > 1 ? 'Preview Platforms' : 'Preview Post'}</button>
                )}
                </div>
                </div>
                <div style={{ flex: '0 1 260px', minWidth: 220, borderRadius: 14, background: 'linear-gradient(135deg,#F5F0FF,#EDE9FE)', border: '1px solid #DDD6FE', padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ width: 32, height: 32, borderRadius: 10, background: '#fff', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>✅</span>
                  <span>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: C.primaryDark }}>Ready for final review?</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>Review the details below to make sure your content is ready before publishing.</span>
                  </span>
                </div>
              </div>
                <div style={{ ...card, borderRadius: 20, padding: '18px 20px', background: '#FFFBEB', borderColor: '#FDE68A' }} className="sp-ord-best">
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>💡 Platform Best Practices</div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, marginBottom: 8, textTransform: 'capitalize' }}>Follow these tips for the best results on {previewPlatform}.</div>
                  {(() => {
                    const tips = previewPlatform === 'linkedin' ? [
                      'Keep your tone professional',
                      'Use meaningful structure',
                      'Use relevant hashtags',
                      'Include a professional CTA',
                    ] : previewPlatform === 'whatsapp' ? [
                      'Keep your message clear and concise',
                      'Use WhatsApp-friendly formatting (*bold*, • lists)',
                      'Use visuals sized correctly (16:9)',
                      'Add a direct CTA',
                    ] : previewPlatform === 'instagram' ? [
                      'Lead with a striking visual hook',
                      'Keep captions short and scannable',
                      'Use 8-12 discoverability hashtags',
                      'End with a save-worthy CTA',
                    ] : previewPlatform === 'facebook' ? [
                      'Write warm, community-first copy',
                      'Spark conversation with a question',
                      'Keep videos under a minute where possible',
                      'Reply to early comments quickly',
                    ] : [
                      'Keep your message clear and concise',
                      'Use visuals sized for this platform',
                      'Add a call-to-action',
                      'Check your preview before publishing',
                    ];
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
                        {tips.map(tip => (
                          <div key={tip} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0' }}>
                            <span style={{ width: 19, height: 19, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>✓</span>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', lineHeight: 1.5 }}>{tip}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <div style={{ borderRadius: 16, padding: '14px 20px', background: 'linear-gradient(135deg,#EDE9FE,#FCE7F3)', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', gap: 12, position: 'relative', overflow: 'hidden' }} className="sp-ord-banner">
                  <span style={{ position: 'absolute', top: -20, right: 60, width: 70, height: 70, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
                  <span style={{ fontSize: 22, flexShrink: 0 }}>✨</span>
                  <span>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: C.ink }}>Everything looks ready</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#475569', marginTop: 1 }}>Preview once before publishing.</span>
                  </span>
                </div>
              </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {showPostPreview && (
              <div onClick={() => setShowPostPreview(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div role="dialog" aria-modal="true" aria-label="Platform preview" onClick={e => e.stopPropagation()} onKeyDown={trapTab} style={{ width: 'min(720px, 94vw)', maxHeight: '90vh', backgroundColor: '#fff', borderRadius: 20, boxShadow: '0 24px 64px rgba(15,23,42,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'inherit' }}>
                  <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>👁 Preview Post</div>
                      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>See exactly how your post will appear before publishing.</div>
                    </div>
                    <button ref={previewCloseRef} onClick={() => setShowPostPreview(false)} aria-label="Close preview" style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${C.border}`, background: '#fff', color: C.muted, fontSize: 15, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                  </div>
                  <div style={{ padding: '12px 22px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['linkedin', 'facebook', 'instagram', 'whatsapp'] as const).filter(pl => p.selectedPlatforms.includes(pl)).map(pl => {
                      const active = previewPlatform === pl;
                      const brand = p.platformColors[pl] || '#0A66C2';
                      return (
                        <button key={pl} onClick={() => { setPreviewPlatform(pl); if (p.platformContent[pl]) p.switchPreviewPlatform(pl); }} aria-label={`Preview ${pl}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, textTransform: 'capitalize', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? '#F5F0FF' : '#fff', color: active ? C.primaryDark : C.muted, cursor: 'pointer', fontFamily: 'inherit' }}>
                          <span style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <p.PlatformIcon platform={pl} size={10} />
                          </span>
                          {pl}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ padding: '14px 22px', overflowY: 'auto', maxHeight: '62vh' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minWidth: 0 }}>
                <div style={{ width: '100%', maxWidth: previewPlatform === 'instagram' ? 480 : previewPlatform === 'whatsapp' ? 400 : 660 }}>
                {previewPlatform === 'instagram' ? (
                  <InstagramPhonePreview
                    username={(p.accounts.find(a => a.platform === 'instagram' && a.connected) as any)?.instagramUsername || p.accounts.find(a => a.platform === 'instagram' && a.connected)?.name || p.accounts.find(a => a.platform === 'facebook' && a.connected)?.name || 'socialpulse'}
                    avatarUrl={p.logoImage || undefined}
                    mediaUrl={previewItems[0]?.url || p.generatedImage || ''}
                    mediaType={previewItems[0]?.type || (p.generatedVideo ? 'video' : 'image')}
                    mediaList={p.isCarousel ? p.carouselSlides : previewItems}
                    currentSlide={carouselPreviewIndex}
                    onSlideChange={setCarouselPreviewIndex}
                    caption={(() => { const tags = p.platformContent[p.activePreviewPlatform]?.hashtags || []; if (!p.content.trim()) return ''; return tags.length ? p.content.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim() : p.content; })()}
                    hashtags={p.platformContent[p.activePreviewPlatform]?.hashtags || []}
                  aspectRatio={p.aspectRatio || '1:1'}
                  isCarousel={p.isCarousel && p.carouselSlides.length > 1}
                />
                ) : previewPlatform === 'facebook' ? (
                  <FacebookPostPreview
                    caption={(() => { const tags = p.platformContent[p.activePreviewPlatform]?.hashtags || []; if (!p.content.trim()) return ''; return tags.length ? p.content.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim() : p.content; })()}
                    hashtags={p.platformContent[p.activePreviewPlatform]?.hashtags || []}
                    mediaUrl={previewItems[0]?.url || p.generatedImage || ''}
                    mediaType={previewItems[0]?.type || (p.generatedVideo ? 'video' : 'image')}
                    mediaList={p.isCarousel ? p.carouselSlides : previewItems}
                    pageName="SocialPulse"
                    avatarUrl={p.logoImage || undefined}
                    aspectRatio={p.aspectRatio || '1:1'}
                  />
                ) : previewPlatform === 'linkedin' ? (
                  <LinkedInPostPreview
                    caption={(() => { const tags = p.platformContent[p.activePreviewPlatform]?.hashtags || []; if (!p.content.trim()) return ''; return tags.length ? p.content.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim() : p.content; })()}
                    hashtags={p.platformContent[p.activePreviewPlatform]?.hashtags || []}
                    mediaUrl={previewItems[0]?.url || p.generatedImage || ''}
                    mediaType={previewItems[0]?.type || (p.generatedVideo ? 'video' : 'image')}
                    mediaList={p.isCarousel ? p.carouselSlides : previewItems}
                    currentSlide={carouselPreviewIndex}
                    onSlideChange={setCarouselPreviewIndex}
                    aspectRatio={p.aspectRatio || '1:1'}
                    isCarousel={p.isCarousel && p.carouselSlides.length > 1}
                    profileName="SocialPulse"
                    profileSubtitle="Social Media Content Manager"
                    avatarUrl={p.logoImage || undefined}
                    logoUrl={p.logoImage || undefined}
                    logoPosition={p.logoPosition}
                    logoScale={p.logoScale}
                    logoOpacity={p.logoOpacity}
                    burnedIds={p.burnedLogoIds}
                  />
                ) : previewPlatform === 'whatsapp' ? (
                  <WhatsAppCommunityPreview
                    communityName={p.whapiGroups.find(g => g.id === p.whapiSelectedGroupId)?.name || 'SocialPulse Testing 🚀'}
                    subtitle="Announcements"
                    destinationType={p.whapiGroups.find(g => g.id === p.whapiSelectedGroupId)?.type || 'announcement_group'}
                    caption={(() => { const c = p.platformContent[p.activePreviewPlatform]?.caption || p.content; return c.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim(); })()}
                    hashtags={[]}
                    mediaUrl={previewItems[0]?.url || p.generatedImage || ''}
                    mediaType={previewItems[0]?.type || (p.generatedVideo ? 'video' : 'image')}
                    mediaList={p.isCarousel ? p.carouselSlides : previewItems}
                    currentSlide={carouselPreviewIndex}
                    onSlideChange={setCarouselPreviewIndex}
                    aspectRatio={p.aspectRatio || '1:1'}
                    isCarousel={p.isCarousel && p.carouselSlides.length > 1}
                  />
                ) : (
                  <div style={{ ...card, borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                    <div style={{ padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ width: 46, height: 46, borderRadius: '50%', background: p.logoImage ? `url(${p.logoImage}) center/cover` : 'linear-gradient(135deg,#0A66C2,#004182)', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', flexShrink: 0 }}>{!p.logoImage && 'SP'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>SocialPulse <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>• 1st</span></div>
                        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>Just now • 🌐 Public</div>
                      </div>
                      <span style={{ color: C.faint, fontSize: 18, fontWeight: 800 }}>⋯</span>
                    </div>
                    <div style={{ padding: '0 20px 6px', fontSize: 13.5, lineHeight: 1.7, color: C.ink, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'hidden' }}>
                      {(() => {
                        if (!p.content.trim()) return `Your amazing post will appear here...\nThis is how it will look on ${previewPlatform.charAt(0).toUpperCase() + previewPlatform.slice(1)}.`;
                        const tags = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
                        if (!tags.length) return p.content;
                        return p.content.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim() || p.content;
                      })()}
                    </div>
                    {(p.platformContent[p.activePreviewPlatform]?.hashtags || []).length > 0 && (
                      <div style={{ padding: '0 20px 14px', fontSize: 13, lineHeight: 1.7, color: '#0A66C2', fontWeight: 600 }}>
                        {(p.platformContent[p.activePreviewPlatform]?.hashtags || []).map(t => '#' + String(t).replace(/^#+/, '')).join(' ')}
                      </div>
                    )}
                    {(p.mediaItems.length > 0 || postExtraImages.length > 0 || p.generatedImage || p.generatedVideo) ? (
                      <div style={{ backgroundColor: '#000' }}>
                        {(() => {
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
                      <div style={{ margin: '4px 20px 16px', border: '2px dashed #C4B5FD', borderRadius: 14, backgroundColor: '#FAF8FF', padding: 32, textAlign: 'center' }}>
                        <div style={{ fontSize: 30 }}>🖼️</div>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginTop: 8 }}>No image yet</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Add media from Step 4</div>
                        <button onClick={() => setCurrentStep(4)} style={{ marginTop: 12, padding: '10px 22px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}>Add Image +</button>
                      </div>
                    )}
                    <div style={{ padding: '12px 20px', display: 'flex', gap: 22, borderTop: `1px solid ${C.borderSoft}`, fontSize: 12, color: C.muted, fontWeight: 600 }}>
                      <span>👍 Like</span><span>💬 Comment</span><span>🔄 Repost</span><span style={{ marginLeft: 'auto' }}>✈️ Send</span>
                    </div>
                  </div>
                )}
              </div>
              </div>
                  </div>
                  <div style={{ padding: '14px 22px 18px', borderTop: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', backgroundColor: '#fff' }}>
                    <button onClick={() => setShowPostPreview(false)} style={{ ...ghostBtn, padding: '11px 20px', fontSize: 13 }}>Close Preview</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => { setShowPostPreview(false); goNext(); }} style={{ padding: '11px 26px', borderRadius: 11, fontSize: 13.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Continue to Publish →</button>
                  </div>
                </div>
              </div>
              )}
              <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <div style={{ ...card, borderRadius: 20, padding: '18px 20px' }} className="sp-ord-final">
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Final Review</div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, marginBottom: 6 }}>Here’s a summary of your content settings.</div>
                  {[
                    ['📝', 'Topic', p.prompt ? (p.prompt.length > 60 ? p.prompt.slice(0, 60) + '…' : p.prompt) : '—'],
                    ['🎭', 'Tone', p.tone],
                    ['🎨', 'Image Style', p.imageStyle],
                    ['📐', 'Aspect Ratio', p.aspectRatio || '—'],
                    ['🖼️', 'Media Count', `${previewMediaCount} file${previewMediaCount === 1 ? '' : 's'}`],
                    ['🏷️', 'Branding', p.logoImage ? `Logo • ${p.logoPosition}` : 'No logo'],
                    ['📣', 'Platform', previewPlatform.charAt(0).toUpperCase() + previewPlatform.slice(1)],
                    ['🎠', 'Post Type', p.isCarousel ? `Carousel • ${p.carouselSlides.length} slides` : 'Single Post'],
                  ].map(([icon, k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: `1px solid ${C.borderSoft}`, fontSize: 12 }}>
                      <span style={{ color: C.muted, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ fontSize: 13 }}>{icon}</span>{k}</span>
                      <span style={{ color: C.ink, fontWeight: 600, textAlign: 'right', maxWidth: '58%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ ...card, borderRadius: 20, padding: '18px 20px' }} className="sp-ord-ready">
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Readiness</div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, marginBottom: 6 }}>Check that everything is ready to go.</div>
                  {(() => {
                    const hasContent = !!p.content.trim();
                    const hasMedia = p.mediaItems.length > 0 || postExtraImages.length > 0 || !!p.generatedImage || !!p.generatedVideo;
                    const mediaCount = previewMediaCount;
                    const platNames = p.selectedPlatforms.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', ');
                    const rows: Array<{ ok: boolean | null; text: string; sub: string; step: number }> = [
                      { ok: hasContent, text: hasContent ? 'Content ready' : 'Content missing — generate in Step 3', sub: hasContent ? 'Your post content has been generated.' : 'Head back to create your copy.', step: 3 },
                      { ok: hasMedia, text: hasMedia ? 'Media ready' : 'Media missing — add a visual from Step 4', sub: hasMedia ? `${mediaCount} media file${mediaCount === 1 ? '' : 's'} attached and optimized.` : 'A visual makes your post perform better.', step: 4 },
                      { ok: p.logoImage ? true : null, text: p.logoImage ? 'Branding applied' : 'No logo — optional', sub: p.logoImage ? 'Your logo will be applied to your visuals.' : 'You can add a logo, or continue without one.', step: 6 },
                      { ok: p.selectedPlatforms.length > 0 ? true : null, text: p.selectedPlatforms.length > 0 ? `${p.selectedPlatforms.length} platform${p.selectedPlatforms.length === 1 ? '' : 's'} selected` : 'Previewing as LinkedIn', sub: p.selectedPlatforms.length > 0 ? `Content is set for ${platNames}.` : 'Pick a platform to publish to.', step: 2 },
                    ];
                    return rows.map(r => (
                      <button key={r.text} onClick={() => setCurrentStep(r.step)} title="Go to this step" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', margin: '0 -10px', borderRadius: 10, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        <span style={{
                          width: 20, height: 20, borderRadius: '50%', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          background: r.ok === true ? '#ECFDF5' : r.ok === false ? '#FFFBEB' : '#F1F3F9',
                          border: `1px solid ${r.ok === true ? '#A7F3D0' : r.ok === false ? '#FDE68A' : '#E2E8F0'}`,
                          color: r.ok === true ? '#059669' : r.ok === false ? '#92400E' : '#94A3B8',
                        }}>{r.ok === true ? '✓' : r.ok === false ? '⚠' : '○'}</span>
                        <span>
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: r.ok === false ? '#92400E' : '#334155', lineHeight: 1.4 }}>{r.text}</span>
                          <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: C.faint, lineHeight: 1.4 }}>{r.sub}</span>
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              </aside>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowCancelPreview(true)} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14, color: '#B91C1C' }}>Cancel</button>
              <button ref={previewBtnRef} onClick={openPostPreview} title="Open the realistic platform preview in a popup" style={{ minHeight: 50, padding: '14px 26px', borderRadius: 12, fontSize: 14, fontWeight: 800, border: `1.5px solid ${C.primary}`, backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer', fontFamily: 'inherit' }}>👁 Preview</button>
              <button onClick={goNext} style={{ minHeight: 50, padding: '14px 34px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Publish →</button>
            </div>
          </div>
        )}

                {/* ================= STEP 8 — PUBLISH ================= */}
        {currentStep === 8 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="sp-s2-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 15, background: 'linear-gradient(135deg,#7C3AED,#A855F7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0, boxShadow: '0 8px 22px rgba(124,58,237,0.4)' }}>✈️</div>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Publish Your Post</div>
                      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Step 8 of 8: Share your content now or schedule it for later</div>
                    </div>
                    <div style={{ flex: '0 1 250px', minWidth: 200, display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F5F0FF', border: '1px solid #DDD6FE', borderRadius: 14, padding: '12px 14px' }}>
                      <span style={{ fontSize: 18, lineHeight: 1.3 }}>👑</span>
                      <span>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: C.primaryDark }}>Great content is meant to be shared!</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2 }}>Choose your platform and timing.</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Publishing Platforms</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 14 }}>Connect your social media accounts to publish your content.</div>
                  <div className="sp-wiz-grid2" style={{ gap: 12 }}>
                    {p.selectedPlatforms.length === 0 && (
                      <div style={{ gridColumn: '1 / -1', fontSize: 12.5, color: C.muted, border: `1.5px dashed ${C.border}`, borderRadius: 14, padding: '18px', textAlign: 'center' }}>
                        No platforms selected — <button onClick={() => setCurrentStep(2)} style={{ background: 'none', border: 'none', padding: 0, color: C.primaryDark, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5 }}>pick platforms in Settings →</button>
                      </div>
                    )}
                    {['linkedin', 'instagram', 'facebook', 'whatsapp'].filter(pl => p.selectedPlatforms.includes(pl)).map(pl => {
                      const label = pl === 'whatsapp' ? 'WhatsApp' : pl.charAt(0).toUpperCase() + pl.slice(1);
                      const isWhapi = pl === 'whatsapp';
                      const selected = p.selectedPlatforms.includes(pl);
                      const connected = isWhapi ? p.whapiConnected : p.accounts.some(a => a.platform === pl && a.connected);
                      const brand = p.platformColors[pl] || C.primary;
                      return (
                        <button key={pl} onClick={() => p.togglePlatform(pl)} className="sp-s2-opt" style={{
                          position: 'relative', padding: '20px 18px', borderRadius: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', fontFamily: 'inherit',
                          border: `2px solid ${selected ? brand : `${brand}45`}`,
                          background: selected ? `${brand}0D` : '#fff',
                          boxShadow: selected ? `0 8px 22px ${brand}35` : '0 1px 2px rgba(15,23,42,0.05)',
                        }}>
                          <span style={{
                            position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: selected ? brand : '#fff', color: selected ? '#fff' : '#CBD5E1',
                            border: selected ? 'none' : '2px solid #E2E8F0',
                            boxShadow: selected ? `0 3px 10px ${brand}55` : 'none',
                          }}>✓</span>
                          <span style={{ width: 54, height: 54, borderRadius: 15, background: `linear-gradient(135deg,${brand},${brand}CC)`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 6px 16px ${brand}45` }}>
                            <p.PlatformIcon platform={pl} size={24} />
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, color: C.ink }}>{label}</span>
                            <span style={{ display: 'inline-block', marginTop: 5, fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, color: connected ? '#059669' : '#64748B', backgroundColor: connected ? '#ECFDF5' : '#F1F5F9', border: `1px solid ${connected ? '#A7F3D0' : '#E2E8F0'}` }}>{connected ? '● Connected' : '● Not connected'}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Connected Accounts</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Accounts ready to publish.</div>
                    </div>
                    <button onClick={() => p.refreshWhapiStatus()} disabled={p.whapiLoading} title="Refresh WhatsApp connection status" style={{ padding: '8px 14px', borderRadius: 9, fontSize: 11.5, fontWeight: 800, border: `1.5px solid ${C.border}`, backgroundColor: '#fff', color: p.whapiLoading ? C.faint : C.primaryDark, cursor: p.whapiLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>{p.whapiLoading ? 'Checking…' : '↻ Refresh'}</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                    {(['linkedin', 'facebook', 'instagram'] as const).map(pl => {
                      const acc = p.accounts.find(a => a.platform === pl && a.connected);
                      const label = pl.charAt(0).toUpperCase() + pl.slice(1);
                      if (!acc) return (
                        <div key={pl} style={{ border: `1.5px dashed ${C.border}`, borderRadius: 14, padding: 16, textAlign: 'center', backgroundColor: '#FCFCFE' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <span style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: p.platformColors[pl], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <p.PlatformIcon platform={pl} size={13} />
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{label}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>{pl === 'instagram' ? 'Connect a Business or Creator account linked to your Facebook Page.' : `No ${label} account connected yet`}</div>
                          <button onClick={() => p.connectPlatform(pl)} style={{ marginTop: 10, padding: '9px 20px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 3px 10px rgba(124,58,237,0.3)' }}>Connect {label}</button>
                        </div>
                      );
                      return (
                        <div key={pl} style={{ padding: 14, border: `1.5px solid ${C.border}`, borderRadius: 14, backgroundColor: '#F8FAFC' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: p.platformColors[pl], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <p.PlatformIcon platform={pl} size={16} />
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: C.ink }}>{acc.name || 'Admin / SocialPulse'}</span>
                              <span style={{ display: 'block', fontSize: 11, color: '#059669', fontWeight: 700, marginTop: 1 }}>✓ Connected{acc.email ? ` • ${acc.email}` : ''}{pl === 'facebook' && acc.pages?.length ? ` • ${(acc.pages.find(pg => pg.id === acc.pageId) || acc.pages[0]).name}` : ''}</span>
                            </span>
                            <button onClick={() => p.disconnectPlatform(pl)} style={{ fontSize: 11, fontWeight: 800, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: 'inherit' }}>{pl === 'instagram' ? 'Deselect' : 'Disconnect'}</button>
                          </div>
                          {pl === 'facebook' && (acc.pages?.length || 0) > 1 && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 11, fontWeight: 700, color: C.muted }}>
                              Page
                              <select
                                value={acc.pageId || acc.pages![0].id}
                                onChange={e => p.setAccountPageId('facebook', e.target.value)}
                                style={{ flex: 1, padding: '8px 12px', borderRadius: 9, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
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

                  <div style={{ marginTop: 12, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: 16, backgroundColor: p.whapiConnected ? '#F0FDF4' : '#FFFBEB' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: p.whapiConnected ? 12 : 0 }}>
                      <span style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: p.whapiConnected ? '#25D366' : '#E2E8F0', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💬</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>WhatsApp</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: p.whapiConnected ? '#059669' : '#92400E' }}>
                          {p.whapiLoading ? 'Checking…' : p.whapiConnected ? `✓ Connected${p.whapiAccountName ? ` • ${p.whapiAccountName}` : ''}${p.whapiPhoneMasked ? ` • ${p.whapiPhoneMasked}` : ''}` : '● Not connected'}
                        </div>
                      </div>
                      {!p.whapiConnected && p.whapiCanConnect && (
                        <button onClick={() => p.startWhatsAppConnect()} disabled={p.whapiLoading} style={{ padding: '9px 18px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 3px 10px rgba(124,58,237,0.3)' }}>Connect WhatsApp</button>
                      )}
                      {p.whapiConnected && (
                        <button onClick={() => p.disconnectWhatsApp()} disabled={p.whatsappDisconnecting || p.whapiLoading} title="Disconnect WhatsApp" style={{ padding: '8px 14px', borderRadius: 9, fontSize: 11.5, fontWeight: 800, border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#DC2626', cursor: (p.whatsappDisconnecting || p.whapiLoading) ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: (p.whatsappDisconnecting || p.whapiLoading) ? 0.6 : 1 }}>{p.whatsappDisconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
                      )}
                    </div>

                    {p.whapiConnected ? (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Destination: <span style={{ fontWeight: 600, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '1px 7px', borderRadius: 999 }}>WhatsApp</span></div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, minWidth: 78 }}>Send to:</label>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <WhatsAppDestinationPicker
                              destinations={p.whapiDestinations}
                              loading={p.whapiGroupsLoading}
                              error={p.whapiGroupsError}
                              selected={p.whapiSelectedDestinations}
                              onChange={p.setWhapiSelectedDestinations}
                              onRefresh={p.loadWhapiDestinations}
                            />
                          </div>
                        </div>

                        {p.whapiDestinations.length === 0 && !p.whapiGroupsLoading && !p.whapiGroupsError && (
                          <button onClick={() => p.loadWhapiDestinations()} style={{ width: '100%', padding: 9, borderRadius: 9, fontSize: 12, fontWeight: 600, border: `1px dashed ${C.border}`, backgroundColor: '#fff', color: C.muted, cursor: 'pointer', marginBottom: 8, fontFamily: 'inherit' }}>Load WhatsApp chats, groups &amp; communities</button>
                        )}
                        {p.whapiGroupsError && <div style={{ fontSize: 11, color: '#DC2626', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '6px 8px', borderRadius: 8, marginBottom: 8 }}>⚠️ {p.whapiGroupsError}</div>}

                        <div style={{ fontSize: 11, color: '#065F46', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '7px 10px', borderRadius: 8, marginBottom: 10 }}>
                          Status: WhatsApp Connected {p.whapiSelectedDestinations.size
                            ? `• ${p.whapiSelectedDestinations.size} destination${p.whapiSelectedDestinations.size === 1 ? '' : 's'} selected`
                            : '• No destination selected'}
                        </div>

                        {/* Whapi's sendMessage takes a single media attachment and has
                            no album/carousel call, so extra media is silently dropped by
                            the client (.slice(0, 1)) and the server. Say so up front
                            instead of letting the post look like it lost an image. */}
                        {postPublishMedia.length > 1 && (
                          <div style={{ fontSize: 11, color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '7px 10px', borderRadius: 8, marginBottom: 10 }}>
                            ⚠️ WhatsApp sends <strong>1 image per message</strong> &mdash; {postPublishMedia.length} are attached, so only{' '}
                            <strong>{postPublishMedia[0].name || 'the first one'}</strong> will be sent. Remove the others in Media (step 4) to change which one goes out.
                          </div>
                        )}

                        {(() => {
                          const hasDestinations = p.whapiSelectedDestinations.size > 0;
                          return (
                            <>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  onClick={() => p.publishToWhapi()}
                                  disabled={p.whapiPublishing || p.isPublishing || p.publishCooldown > 0 || !hasDestinations || (!p.content.trim() && p.mediaItems.length === 0 && !p.generatedImage)}
                                  title={!hasDestinations ? 'Select at least one chat, group or community' : !p.content.trim() && p.mediaItems.length === 0 && !p.generatedImage ? 'Add content or media first' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : `Publish to ${p.whapiSelectedDestinations.size} destination(s)`}
                                  style={{ flex: 1, minHeight: 38, padding: '9px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: 'none', background: (p.whapiPublishing || p.isPublishing || p.publishCooldown > 0 || !hasDestinations || (!p.content.trim() && p.mediaItems.length === 0 && !p.generatedImage)) ? '#DDD6FE' : 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff', cursor: (p.whapiPublishing || p.isPublishing || p.publishCooldown > 0 || !hasDestinations) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: (p.whapiPublishing || p.isPublishing) ? 'none' : '0 3px 12px rgba(37,211,102,0.3)' }}
                                >
                                  {p.whapiPublishing ? 'Sending…' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : `📨 Publish to ${p.whapiSelectedDestinations.size || ''} WhatsApp ${p.whapiSelectedDestinations.size === 1 ? 'destination' : 'destinations'}`}
                                </button>
                              </div>
                              <div style={{ fontSize: 10, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>One click = one message per selected destination. No hidden retries.</div>
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
                </div>

                <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Publishing Options</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>Choose when to share your post.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                    {([
                      ['now', '🚀', 'Publish Now', 'Share immediately across selected platforms'],
                      ['later', '📅', 'Schedule for Later', 'Pick a date and time to publish'],
                    ] as const).map(([k, icon, t, s]) => (
                      <button key={k} onClick={() => setPublishMode(k)} className="sp-s2-opt" style={{
                        padding: 16, borderRadius: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', fontFamily: 'inherit',
                        border: publishMode === k ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`,
                        background: publishMode === k ? 'linear-gradient(180deg,#F6F1FF,#EDE9FE)' : '#fff',
                        boxShadow: publishMode === k ? '0 6px 20px rgba(124,58,237,0.18)' : '0 1px 2px rgba(15,23,42,0.04)',
                      }}>
                        <span style={{ fontSize: 26 }}>{icon}</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: publishMode === k ? C.primaryDark : C.ink }}>{t}</span>
                          <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{s}</span>
                        </span>
                        <span style={{ width: 20, height: 20, borderRadius: '50%', border: publishMode === k ? `2px solid ${C.primary}` : `1.5px solid #CBD5E1`, backgroundColor: publishMode === k ? C.primary : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{publishMode === k ? '●' : ''}</span>
                      </button>
                    ))}
                  </div>
                  {publishMode === 'later' && (
                    <button onClick={() => p.setScheduleModalOpen(true)} style={{ marginTop: 10, width: '100%', padding: 13, borderRadius: 12, border: `1.5px dashed ${C.primaryBorder}`, backgroundColor: '#FAF8FF', color: C.primaryDark, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>📅 Pick a date & time (5+ min ahead)</button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, flex: 1 }}>Post Summary</div>
                    <button onClick={() => setCurrentStep(3)} title="Edit content" style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 800, border: `1.5px solid ${C.border}`, backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer', fontFamily: 'inherit' }}>✏️ Edit</button>
                  </div>
                  {(() => {
                    const thumb = (p.isCarousel ? p.carouselSlides : p.mediaItems)[0] || null;
                    const thumbUrl = thumb?.url || p.generatedImage || p.generatedVideo || postExtraImages[0]?.url || '';
                    const thumbIsVideo = thumb ? thumb.type === 'video' : !!p.generatedVideo && !thumb;
                    const title = (p.content.split('\n')[0] || p.prompt.split('\n')[0] || 'Untitled post').slice(0, 60);
                    return (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        {thumbUrl ? (
                          <span style={{ width: 76, height: 76, borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}`, backgroundColor: '#000', flexShrink: 0, display: 'block' }}>
                            {thumbIsVideo ? <video src={thumbUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          </span>
                        ) : (
                          <span style={{ width: 76, height: 76, borderRadius: 14, background: '#F1F3F9', border: `1.5px dashed ${C.border}`, color: C.faint, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>🖼️</span>
                        )}
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: C.ink, lineHeight: 1.4 }}>{title}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>{((p.content.split('\n').slice(1).join(' ') || p.content).trim() || 'No caption yet').slice(0, 140)}</span>
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                    {[
                      p.selectedPlatforms.length ? p.selectedPlatforms.map(pl => pl.charAt(0).toUpperCase() + pl.slice(1)).join(' • ') : 'No platform selected',
                      p.isCarousel ? `Carousel • ${p.carouselSlides.length}` : 'Single Post',
                      p.aspectRatio || 'No ratio',
                      p.imageStyle,
                      ...(p.trialReel && p.instagramReelReady ? ['Trial Reel'] : []),
                      ...(p.collaborator && p.selectedPlatforms.includes('instagram') ? [`@${p.collaborator}`] : []),
                    ].map(chip => (
                      <span key={chip} style={{ fontSize: 10.5, fontWeight: 700, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '4px 11px', borderRadius: 999 }}>{chip}</span>
                    ))}
                  </div>
                  {p.isCarousel && (
                    <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, padding: '7px 10px', borderRadius: 8, border: `1px solid ${p.carouselValidation.valid ? '#A7F3D0' : '#FDE68A'}`, backgroundColor: p.carouselValidation.valid ? '#ECFDF5' : '#FFFBEB', color: p.carouselValidation.valid ? '#065F46' : '#92400E' }}>
                      {p.carouselValidation.valid ? `🎠 Carousel: ${p.carouselSlides.length} slides ✓ ready` : `🎠 Carousel: ${p.carouselValidation.reason}`}
                    </div>
                  )}
                  {p.instagramReelReady && (
                    <div style={{ marginTop: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', borderRadius: 11, border: `1.5px solid ${p.trialReel ? C.primary : C.border}`, backgroundColor: p.trialReel ? C.primarySoft : '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <input type="checkbox" checked={p.trialReel} onChange={e => p.setTrialReel(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#7C3AED', cursor: 'pointer' }} />
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: p.trialReel ? C.primaryDark : C.ink }}>Post as Trial Reel</span>
                      </label>
                      {p.trialReel && (
                        <div style={{ marginTop: 7, fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>Trial Reels are shown to non-followers first (single video only, never a normal Reel to followers).</div>
                      )}
                    </div>
                  )}
                  {p.selectedPlatforms.includes('instagram') && (
                    <div style={{ marginTop: 10 }}>
                      <label htmlFor="sp-collab" style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Instagram collaborator (optional)</label>
                      <input
                        id="sp-collab"
                        value={p.collaborator}
                        onChange={e => p.setCollaborator(e.target.value.replace(/^@+/, '').slice(0, 30))}
                        placeholder="username (without @)"
                        autoComplete="off"
                        style={{ width: '100%', padding: '10px 13px', borderRadius: 11, border: `1.5px solid ${p.collaborator ? C.primary : C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }}
                      />
                      <div style={{ marginTop: 6, fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>They get an invite inside Instagram and must accept before the collab shows on the post.</div>
                    </div>
                  )}
                </div>

                <div style={{ ...card, borderRadius: 20, padding: '20px 22px' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Content Readiness</div>
                  {(() => {
                    const contentOk = !!p.content.trim();
                    const mediaOk = p.mediaItems.length > 0 || postExtraImages.length > 0 || !!p.generatedImage || !!p.generatedVideo;
                    const connectTarget = (['linkedin', 'facebook', 'instagram'] as const).find(pl => p.selectedPlatforms.includes(pl) && !p.accounts.some(a => a.platform === pl && a.connected))
                      || (p.selectedPlatforms.includes('whatsapp') && !p.whapiConnected ? 'whatsapp' as const : null);
                    const rows: Array<{ state: 'ok' | 'warn' | 'neutral'; label: string; action: string; run: () => void }> = [
                      { state: contentOk ? 'ok' : 'warn', label: contentOk ? 'Content ready' : 'Content missing', action: 'Edit Content →', run: () => setCurrentStep(3) },
                      { state: mediaOk ? 'ok' : 'warn', label: mediaOk ? 'Media ready' : 'Media missing', action: 'Edit Media →', run: () => setCurrentStep(4) },
                      { state: p.logoImage ? 'ok' : 'neutral', label: p.logoImage ? 'Branding applied' : 'No logo (optional)', action: 'Edit Branding →', run: () => setCurrentStep(6) },
                      connectedSelected.length > 0
                        ? { state: 'ok' as const, label: `${connectedSelected.length} connected platform${connectedSelected.length === 1 ? '' : 's'}`, action: 'Review →', run: () => setCurrentStep(7) }
                        : { state: 'warn' as const, label: 'Connect platform to publish', action: 'Connect Now →', run: () => { if (connectTarget === 'whatsapp' && p.whapiCanConnect) p.startWhatsAppConnect(); else if (connectTarget === 'whatsapp') setCurrentStep(2); else if (connectTarget) p.connectPlatform(connectTarget); else setCurrentStep(2); } },
                    ];
                    return rows.map(r => (
                      <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                        <span style={{
                          width: 20, height: 20, borderRadius: '50%', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          background: r.state === 'ok' ? '#ECFDF5' : r.state === 'warn' ? '#FFFBEB' : '#F1F3F9',
                          border: `1px solid ${r.state === 'ok' ? '#A7F3D0' : r.state === 'warn' ? '#FDE68A' : '#E2E8F0'}`,
                          color: r.state === 'ok' ? '#059669' : r.state === 'warn' ? '#92400E' : '#94A3B8',
                        }}>{r.state === 'ok' ? '✓' : r.state === 'warn' ? '⚠' : '○'}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: r.state === 'warn' ? '#92400E' : C.ink, flex: 1 }}>{r.label}</span>
                        <button onClick={r.run} style={{ fontSize: 11, fontWeight: 800, background: 'none', border: 'none', color: C.primaryDark, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{r.action}</button>
                      </div>
                    ));
                  })()}
                </div>

                <div style={{ position: 'relative', borderRadius: 20, padding: '26px 22px 22px', background: 'linear-gradient(135deg,#EDE9FE 0%,#DDD6FE 100%)', border: '1px solid #C4B5FD', overflow: 'hidden', textAlign: 'center' }}>
                  <span style={{ position: 'absolute', top: 14, left: 16, width: 30, height: 30, borderRadius: '50%', background: '#0A66C2', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(10,102,194,0.35)' }}>in</span>
                  <span style={{ position: 'absolute', top: 44, right: 14, width: 30, height: 30, borderRadius: '50%', background: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(15,23,42,0.12)' }}>📸</span>
                  <span style={{ position: 'absolute', bottom: 72, left: 12, width: 30, height: 30, borderRadius: '50%', background: '#1877F2', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(24,119,242,0.35)' }}>f</span>
                  <span style={{ position: 'absolute', bottom: 96, right: 18, width: 30, height: 30, borderRadius: '50%', background: '#25D366', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(37,211,102,0.35)' }}>💬</span>
                  <span style={{ position: 'absolute', top: 12, right: 52, fontSize: 15 }}>✨</span>
                  <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto', boxShadow: '0 8px 24px rgba(124,58,237,0.25)', border: '1px solid #E9D5FF' }}>🤖</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginTop: 14, letterSpacing: '-0.01em', lineHeight: 1.4 }}>Share Your Story<br />with the World! ✨</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, fontWeight: 600 }}>Create. Connect. Grow.</div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 14, fontSize: 12.5, fontWeight: 700, border: `1px solid ${canPublish ? '#A7F3D0' : '#FDE68A'}`, backgroundColor: canPublish ? '#ECFDF5' : '#FFFBEB', color: canPublish ? '#065F46' : '#92400E' }}>
              <span style={{ fontSize: 15 }}>{canPublish ? '✓' : '✨'}</span>
              <span>{canPublish ? 'Ready to publish' : `Everything looks good. ${publishBlocker.charAt(0).toUpperCase() + publishBlocker.slice(1)} to continue.`}</span>
            </div>

            <div style={{ position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 6px', background: 'rgba(247,248,252,0.92)', backdropFilter: 'blur(8px)', borderTop: `1px solid ${C.borderSoft}`, flexWrap: 'wrap' }}>
              <button onClick={goBack} style={{ ...ghostBtn, minHeight: 52, padding: '14px 26px', fontSize: 14 }}>← Back</button>
              <div style={{ flex: 1 }} />
              <button onClick={saveDraft} style={{ ...ghostBtn, minHeight: 52, padding: '14px 24px', fontSize: 14, width: 'auto' }}>💾 Save as Draft</button>
              {publishMode === 'now' ? (
                <button onClick={p.publishToAll} disabled={p.isPublishing || p.publishCooldown > 0 || !canPublish} title={!canPublish ? publishBlocker : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s before publishing again` : 'Publish now'}
                  style={{ minHeight: 52, padding: '14px 32px', borderRadius: 13, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: (p.isPublishing || p.publishCooldown > 0 || !canPublish) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', background: (p.isPublishing || p.publishCooldown > 0 || !canPublish) ? '#DDD6FE' : 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: (p.isPublishing || p.publishCooldown > 0 || !canPublish) ? 'none' : '0 6px 22px rgba(124,58,237,0.42)' }}>
                  {p.isPublishing ? 'Publishing…' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : '🚀 Publish Now →'}
                </button>
              ) : (
                <button onClick={() => p.setScheduleModalOpen(true)} disabled={!canPublish} title={!canPublish ? publishBlocker : 'Schedule post'} style={{ minHeight: 52, padding: '14px 32px', borderRadius: 13, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: !canPublish ? 'not-allowed' : 'pointer', fontFamily: 'inherit', background: !canPublish ? '#DDD6FE' : 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: !canPublish ? 'none' : '0 6px 22px rgba(124,58,237,0.42)' }}>📅 Schedule Post →</button>
              )}
            </div>
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

      {showRegenPicker && (
        <div onClick={() => setShowRegenPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(15,23,42,0.46)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="regen-picker-title" onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 100%)', backgroundColor: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(15,23,42,0.22)', fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <h3 id="regen-picker-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.ink }}>↻ Regenerate Content</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.muted }}>Your selected platforms — regenerate one, or all at once.</p>
              </div>
              <button onClick={() => setShowRegenPicker(false)} title="Close" style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', color: C.muted, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
              {p.selectedPlatforms.map(plat => {
                const entry = p.platformContent[plat];
                const ready = !!entry?.caption?.trim();
                const busy = !canGenContent || p.isGeneratingContent;
                const brand = p.platformColors[plat] || C.primary;
                return (
                  <div key={plat} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, border: `1px solid ${C.border}`, backgroundColor: '#fff' }}>
                    <span style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <p.PlatformIcon platform={plat} size={16} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: C.ink, textTransform: 'capitalize' }}>{plat}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: ready ? '#15803D' : C.faint }}>{ready ? `✓ Ready · ${entry.caption.length} chars` : '○ Not generated yet'}</span>
                    </span>
                    <button onClick={() => p.regeneratePlatform(plat)} disabled={busy} title={busy ? (p.isGeneratingContent ? 'Generating — please wait' : genContentBlocker) : `Regenerate only ${plat} — other platforms are untouched`} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 800, border: `1.5px solid ${busy ? '#E8EAF1' : C.primaryBorder}`, backgroundColor: busy ? '#fff' : C.primarySoft, color: busy ? '#B6BDCC' : C.primaryDark, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>↻ Regen</button>
                  </div>
                );
              })}
            </div>
            {p.isGeneratingContent && <p style={{ margin: '0 0 12px', fontSize: 12, color: C.primaryDark, background: C.primarySoft, borderRadius: 9, padding: '8px 12px' }}>Generating… you can close this popup, the work continues in the background.</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setShowRegenPicker(false)} style={ghostBtn}>Cancel</button>
              <button onClick={() => { setShowRegenPicker(false); p.generateContent(); }} disabled={!canGenContent || p.isGeneratingContent} title={!canGenContent ? genContentBlocker : 'Regenerate content for all selected platforms'} style={{ padding: '10px 18px', borderRadius: 11, fontSize: 12.5, fontWeight: 800, border: 'none', background: (!canGenContent || p.isGeneratingContent) ? '#E8EAF1' : 'linear-gradient(135deg,#7C3AED,#A855F7)', color: (!canGenContent || p.isGeneratingContent) ? '#B6BDCC' : '#fff', cursor: (!canGenContent || p.isGeneratingContent) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: (!canGenContent || p.isGeneratingContent) ? 'none' : '0 6px 22px rgba(124,58,237,0.42)' }}>✨ Regenerate All</button>
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
