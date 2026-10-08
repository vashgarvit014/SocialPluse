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

const PLATFORM_DESCS: Record<string, string> = {
  linkedin: 'Professional network',
  facebook: 'Community & business',
  instagram: 'Visual storytelling',
  whatsapp: 'Direct audience reach',
};

// Supplied brand artwork for the selectable platform cards (falls back to
// the PlatformIcon glyph if an image ever fails to load).
const PLATFORM_IMGS: Record<string, string> = {
  linkedin: '/brand-icons/linkedin.webp',
  facebook: '/brand-icons/facebook.png',
  instagram: '/brand-icons/instagram.png',
  whatsapp: '/brand-icons/whatsapp.png',
};

// Generation phases for the Step 3 animation panel (presentation only —
// start/completion are driven by the real p.isGeneratingContent flag).
const GEN_PHASES: Array<[string, string]> = [
  ['Understanding your idea', 'Finding the best angle, structure and audience fit.'],
  ['Building the content structure', 'Creating the hook, message flow and call to action.'],
  ['Writing your content', 'Generating platform-ready copy for your selected tone.'],
  ['Applying your brand voice', 'Refining wording, style and hashtags for consistency.'],
];

// Stepper
// ---------------------------------------------------------------------------
const STEPS = [
  { n: 1, t: 'Idea' },
  { n: 2, t: 'Settings' },
  { n: 3, t: 'Content' },
  { n: 4, t: 'Media' },
  { n: 5, t: 'Design' },
  { n: 6, t: 'Personalization' },
  { n: 7, t: 'Branding' },
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
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [brandPanelOpen, setBrandPanelOpen] = useState(false);
  // ---- Step 4 local UI state (workspace mode + AI prompt editor only) ----
  // mediaTab switches the featured workspace panel (AI / upload / library).
  // All panels stay reachable — nothing is unmounted for good, and every
  // action below calls the existing page.tsx handlers (no new APIs).
  const [mediaTab, setMediaTab] = field<'ai' | 'upload' | 'library'>('mediaTab', 'ai');
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
  // Synchronized generation progress (Step 3). The REAL request flag is the
  // single source of truth: progress eases toward a 90% ceiling while the
  // request is pending (fast early, asymptotic later, never 100% early),
  // finishes smoothly to 100% only after the response arrives, and content
  // reveals only in 'success'. Failures stop honestly with retry.
  type GenStage = 'idle' | 'generating' | 'finishing' | 'success' | 'error';
  const [genStage, setGenStage] = useState<GenStage>('idle');
  const [genPct, setGenPct] = useState(0);
  const genPctRef = useRef(0);
  const genRaf = useRef<number | null>(null);
  const genHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasGenBusy = useRef(false);
  const stopGenLoop = () => {
    if (genRaf.current !== null) cancelAnimationFrame(genRaf.current);
    genRaf.current = null;
    if (genHold.current !== null) { clearTimeout(genHold.current); genHold.current = null; }
  };
  useEffect(() => {
    const busy = p.isGeneratingContent;
    if (busy && !wasGenBusy.current) {
      // Real request started: reset and ease toward the ceiling.
      // pct(t) = 90 * (1 - e^(-t/3225ms)): ~12% @0.5s, ~24% @1s, ~40% @2s,
      // ~55% @3s, ~70% @5s, ~82% @8s, asymptotic to 90% on long waits.
      stopGenLoop();
      genPctRef.current = 0;
      setGenPct(0);
      setGenStage('generating');
      const t0 = performance.now();
      const tick = () => {
        const el = Math.max(0, performance.now() - t0);
        const v = 90 * (1 - Math.exp(-el / 3225));
        genPctRef.current = v;
        setGenPct(v);
        genRaf.current = requestAnimationFrame(tick);
      };
      genRaf.current = requestAnimationFrame(tick);
    }
    if (!busy && wasGenBusy.current) {
      // Real response arrived (or the request failed): finish or stop.
      stopGenLoop();
    if (p.generationError || !p.content.trim()) {
      setGenStage('error');
    } else {
      genSigRef.current = genSigFor();
      setGenStage('finishing');
        const from = genPctRef.current;
        const f0 = performance.now();
        const dur = 600;
        const step = () => {
          const t = Math.min(1, Math.max(0, (performance.now() - f0) / dur));
          const e = 1 - Math.pow(1 - t, 3);
          const v = from + (100 - from) * e;
          genPctRef.current = v;
          setGenPct(v);
          if (t < 1) {
            genRaf.current = requestAnimationFrame(step);
          } else {
            setGenPct(100);
            genPctRef.current = 100;
            genHold.current = setTimeout(() => setGenStage('success'), 280);
          }
        };
        genRaf.current = requestAnimationFrame(step);
      }
    }
    wasGenBusy.current = busy;
    return () => { stopGenLoop(); };
    // Intentionally keyed on the request flag only: completion is evaluated
    // from the fresh render's content/error at the moment the flag flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.isGeneratingContent]);
  // Step 3 owns generation: on entry, reuse content only when it matches the
  // current inputs; otherwise start a fresh request immediately so the first
  // visible state is the animation, never stale content or a blank page.
  useEffect(() => {
    if (currentStep !== 3 || p.isGeneratingContent) return;
    const sig = genSigFor();
    if (genSigRef.current === null && p.content.trim()) {
      genSigRef.current = sig;
      return;
    }
    if ((!p.content.trim() || genSigRef.current !== sig) && canGenContent) {
      p.generateContent();
    }
    // Runs on step entry only; generation state drives everything after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);
  // Inline hashtag composer (Step 3). Appends to the caption through the
  // exact same per-platform write-back path as the chip toggles.
  const [newTag, setNewTag] = useState('');
  const addTag = () => {
    const t = newTag.trim().replace(/^#+/, '');
    if (!t || p.activePreviewPlatform === 'whatsapp') return;
    const tagText = '#' + t;
    const v = p.content.includes(tagText) ? p.content : `${p.content.trim()} ${tagText}`.trim();
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
    setNewTag('');
  };
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
  // Generation signature: identifies the exact inputs (topic/tone/platforms)
  // some content was made from. Step 3 compares it on entry to decide
  // between reusing content and starting a fresh generation.
  const genSigRef = useRef<string | null>(null);
  const genSigFor = () => JSON.stringify({ t: p.prompt, tone: p.tone, plats: [...p.selectedPlatforms].sort() });

  const hasTopic = !!p.prompt.trim() || p.topicMediaItems.length > 0;
  const hasContent = !!p.content.trim();
  const hasMedia = p.mediaItems.length > 0 || !!p.generatedImage || !!p.generatedVideo;
  // Publishing needs a CONNECTED platform (the OAuth token actually posts).
  // Unlike generation, selection alone is not enough here.
  const isPlatformConnected = (pl: string) =>
    pl === 'whatsapp' ? p.whapiConnected : p.accounts.some(a => a.platform === pl && a.connected);
  const connectedSelected = p.selectedPlatforms.filter(isPlatformConnected);
  // Schedule validation mirrors the Scheduler rule: at least 5 minutes ahead,
  // evaluated in the browser's LOCAL timezone (never silently treated as UTC).
  const minScheduleMs = Date.now() + 5 * 60 * 1000;
  const minScheduleDateStr = new Date(minScheduleMs).toLocaleDateString('en-CA');
  const scheduledAtLocal = (() => {
    if (!p.scheduleDate || !p.scheduleTime) return NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(`${p.scheduleDate}T${p.scheduleTime}`);
    if (!m) return NaN;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  })();
  const scheduleIsValid = Number.isFinite(scheduledAtLocal) && scheduledAtLocal >= minScheduleMs;
  const userTimeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'; } catch { return 'Local time'; } })();
  // Post Summary caption. The reveal below is purely decorative: the full text
  // already exists in state and nothing is generated or fetched here.
  const summaryCaption = (p.platformContent[p.activePreviewPlatform]?.caption || p.content || '').trim();
  const [capReveal, setCapReveal] = useState(0);
  useEffect(() => {
    if (currentStep !== 8) return;
    if (!summaryCaption) { setCapReveal(0); return; }
    const calm = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (calm) { setCapReveal(summaryCaption.length); return; }
    let i = 0;
    setCapReveal(0);
    // Reference timing: 700ms lead-in, then one character every 28ms.
    let tick: ReturnType<typeof setInterval> | undefined;
    const lead = setTimeout(() => {
      tick = setInterval(() => {
        i += 1;
        setCapReveal(i);
        if (i >= summaryCaption.length && tick) clearInterval(tick);
      }, 28);
    }, 700);
    return () => { clearTimeout(lead); if (tick) clearInterval(tick); };
  }, [currentStep, summaryCaption]);
  const capTyping = capReveal < summaryCaption.length;
  // Selected-but-unconnected platforms. Previously publishing was allowed as
  // long as ONE platform was connected, which silently dropped the others -
  // the user saw "published" without realising a platform was skipped.
  const disconnectedSelected = p.selectedPlatforms.filter(pl => !isPlatformConnected(pl));
  // Reference animates this ring to a hardcoded 75%. That number is fabricated,
  // so the animation is identical but the target is derived from the real
  // required checks: content, media, and every selected platform connected.
  const readinessChecks = [
    hasContent,
    hasMedia || postExtraImages.length > 0,
    p.selectedPlatforms.length > 0 && disconnectedSelected.length === 0,
  ];
  const readinessPct = Math.round((readinessChecks.filter(Boolean).length / readinessChecks.length) * 100);
  const [ringPct, setRingPct] = useState(0);
  useEffect(() => {
    if (currentStep !== 8) return;
    if (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setRingPct(readinessPct);
      return;
    }
    let n = 0;
    setRingPct(0);
    const id = setInterval(() => {
      n += 3;
      setRingPct(Math.min(n, readinessPct));
      if (n >= readinessPct) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [currentStep, readinessPct]);
  const summaryCardRef = useRef<HTMLDivElement | null>(null);
  // Correct brand casing — "LinkedIn", not "Linkedin".
  const platformLabel = (pl: string) => (pl === 'linkedin' ? 'LinkedIn' : pl === 'whatsapp' ? 'WhatsApp' : pl.charAt(0).toUpperCase() + pl.slice(1));
  const disconnectedNames = disconnectedSelected.map(platformLabel).join(', ');
  // Carousel posts additionally need 2+ image slides before publishing.
  const canPublish = hasContent
    && p.selectedPlatforms.length > 0
    && disconnectedSelected.length === 0
    && (!p.isCarousel || p.carouselValidation.valid)
    && (publishMode !== 'later' || scheduleIsValid);
  const publishBlocker = !hasContent
    ? 'Generate content first'
    : p.selectedPlatforms.length === 0
      ? 'Select a platform above first'
      : p.isCarousel && !p.carouselValidation.valid
        ? p.carouselValidation.reason
        : disconnectedSelected.length === 1
          ? `Connect ${disconnectedNames} or remove it from this publish before continuing.`
          : disconnectedSelected.length > 1
            ? `Connect ${disconnectedNames} or remove them from this publish before continuing.`
            : publishMode === 'later' && !scheduleIsValid
              ? 'Please choose a future date and time.'
              : '';
  // Content generation needs only a SELECTED platform - no connection
  // required (connection is only needed later, to publish). Any selected
  // platform unlocks it, so the button state stays honest.
  const genPlatformSelected = p.selectedPlatforms.length > 0;
  const canGenContent = !p.isGeneratingContent && hasTopic && genPlatformSelected;
  const genContentBlocker = !hasTopic
    ? 'Enter a topic first (Step 1)'
    : !genPlatformSelected
      ? 'Select at least one platform.'
      : '';
  const canGenImage = !p.isGeneratingImage && !!p.aspectRatio && !!p.content.trim();

  const activeTags = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
  // Chips show generated hashtags plus any the user typed into the caption,
  // so added tags stay visible and removable without a second state.
  const captionTags = (p.content.match(/#[A-Za-z0-9_]+/g) || []).map(t => t.slice(1));
  const chipTags: string[] = Array.from(new Set([...activeTags.map((t: unknown) => String(t)), ...captionTags]));
  // Generation phase follows progress: 0–25 / 25–50 / 50–75 / 75–100 map to
  // the four stages; completion is handled separately by genPct >= 100.
  const genPhaseShown = Math.min(3, Math.max(0, Math.floor(genPct / 25)));
  const genPhaseShownSafe = GEN_PHASES[genPhaseShown] || GEN_PHASES[3];
  // First paint on a stale/empty Step 3 shows the animation immediately; the
  // entry effect above starts the matching request in the same commit, so the
  // user never sees stale content flash or a blank page. Scoped to 'idle' so
  // it can never swallow the error/success states once a cycle has run.
  const step3Sig = genSigFor();
  const step3Adopted = genSigRef.current === null && !!p.content.trim();
  const step3NeedsGen = genStage === 'idle' && currentStep === 3 && !p.isGeneratingContent && canGenContent && !step3Adopted && (!p.content.trim() || genSigRef.current !== step3Sig);
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

  // Inline per-image ALT editors (Step 6): textarea + counter always visible,
  // Generate fills only missing descriptions, Regenerate refreshes them all.
  const altTextControls = (
    <section style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>Image ALT Text</span>
        <span style={{ fontSize: 11, color: C.muted }}>Descriptions stay with your images.</span>
      </div>
      {(() => {
        const imgs = accessibilityMedia.filter(m => m.type === 'image');
        const missing = imgs.filter(m => !m.altText?.trim());
        return (
          <>
            {imgs.map((m, i) => (
              <div key={m.id} style={{ marginBottom: 10 }}>
                {imgs.length > 1 && <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 4 }}>Image {i + 1}</div>}
                <textarea
                  aria-label={`ALT description for image ${i + 1}`}
                  placeholder="Write a short, clear description of this image..."
                  value={m.altText || ''}
                  maxLength={500}
                  onChange={e => p.updateAltText(m.id, e.target.value.slice(0, 500))}
                  rows={3}
                  style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, font: 'inherit', fontSize: 13, lineHeight: 1.5, resize: 'vertical', color: C.ink }}
                />
                <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{(m.altText || '').length} / 500</div>
              </div>
            ))}
            <button style={{ ...ghostBtn, minHeight: 40, fontSize: 12.5, opacity: p.altBusy || !imgs.length ? .6 : 1 }} disabled={p.altBusy || !imgs.length} onClick={() => p.generateAltText(missing.length ? missing : imgs)}>{p.altBusy ? 'Generating description…' : missing.length ? '✨ Generate Description' : 'Regenerate Description'}</button>
          </>
        );
      })()}
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
        /* Step 4 friendly option grids: 4 across desktop, 2x2 tablet,
           2 columns on phones, single column only when very narrow. */
        .sp-size-grid{display:grid;gap:10px;grid-template-columns:repeat(4,minmax(0,1fr));}
        @media (max-width:899px){.sp-size-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
        @media (max-width:379px){.sp-size-grid{grid-template-columns:minmax(0,1fr);}}
        .sp-tone-grid,.sp-plat-grid{display:grid;gap:10px;margin-bottom:24px;grid-template-columns:repeat(4,minmax(0,1fr));}
        @media (max-width:899px){.sp-tone-grid,.sp-plat-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
        @media (max-width:599px){.sp-tone-grid{grid-template-columns:minmax(0,1fr);}.sp-plat-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
        @media (max-width:379px){.sp-plat-grid{grid-template-columns:minmax(0,1fr);}}
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
        .sp-soc { position: absolute; width: 52px; height: 52px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #fff; cursor: default; transition: transform 180ms ease, box-shadow 180ms ease; will-change: transform; }
        .sp-soc:hover { transform: scale(1.06); }
        .sp-robot { position: absolute; left: 50%; top: 50%; width: 74px; height: 74px; margin-left: -37px; margin-top: -37px; border-radius: 24px; background: linear-gradient(135deg,#7C3AED,#A855F7); display: flex; align-items: center; justify-content: center; font-size: 38px; box-shadow: 0 10px 28px rgba(124,58,237,.45), inset 0 1px 0 rgba(255,255,255,.35); z-index: 2; }
        .sp-s8-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;margin-top:22px}
        .sp-s8-stack{display:flex;flex-direction:column;gap:18px;min-width:0}
        .sp-s8-aside{position:sticky;top:96px;align-self:start;min-width:0}
        .sp-s8-card-base{background:#fff;border-radius:20px;border:1px solid #e8eaf2;box-shadow:0 6px 24px rgba(17,24,39,.04);padding:26px}
        .sp-s8-hero-wrap{display:flex;align-items:center;gap:18px;flex-wrap:nowrap}
        .sp-s8-ico{width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;display:grid;place-items:center;font-size:26px;box-shadow:0 10px 22px rgba(124,58,237,.27);flex-shrink:0}
        .sp-s8-h2{font-size:26px;font-weight:800;color:#111827;letter-spacing:-0.02em;white-space:nowrap}
        .sp-s8-tag{margin-left:auto;text-align:left;flex-shrink:1;align-self:center;background:#f1ebff;border:1px solid #ddd0fb;color:#6d28d9;border-radius:14px;padding:12px 18px;font-weight:700;font-size:14px;line-height:1.4}
        .sp-s8-tag small{display:block;font-weight:500;color:#5b6475}
        .sp-s8-sec{display:flex;align-items:center;gap:14px;margin-bottom:18px}
        .sp-s8-num{width:34px;height:34px;border-radius:50%;background:#7c3aed;color:#fff;display:grid;place-items:center;font-weight:800;flex-shrink:0;font-size:15px}
        .sp-s8-sec h3{font-size:19px;font-weight:800;color:#111827;margin:0}
        .sp-s8-sec .sub{margin:0;font-size:13.5px;color:#5b6475}
        .sp-s8-btn{padding:14px 26px;border-radius:14px;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer;border:1px solid transparent}
        .sp-s8-btn.primary{background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;box-shadow:0 10px 22px rgba(124,58,237,.27)}
        .sp-s8-btn.primary:hover{filter:brightness(1.08)}
        .sp-s8-btn.ghost{background:#fff;border:1px solid #e8eaf2;color:#111827}
        .sp-s8-btn.ghost:hover{background:#f7f8fc}
        .sp-s8-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;filter:none}
        .sp-s8-plat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
        .sp-s8-plat{position:relative;text-align:left;border:1.5px solid #e8eaf2;border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:14px;background:#fff;transition:.15s;font-family:inherit}
        .sp-s8-plat:hover{border-color:#ddd0fb;box-shadow:0 8px 20px rgba(17,24,39,.05)}
        .sp-s8-plat.selected{border-color:#7c3aed;background:#faf7ff;box-shadow:0 0 0 3px rgba(124,58,237,.12)}
        .sp-s8-plat .top{display:flex;align-items:center;gap:14px}
        .sp-s8-logo-p{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:18px;flex-shrink:0}
        .sp-s8-plat b{display:block;font-size:16px;color:#111827}
        .sp-s8-status{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#5b6475;background:#f1f3f9;border-radius:999px;padding:3px 10px;margin-top:4px}
        .sp-s8-status::before{content:"";width:7px;height:7px;border-radius:50%;background:#94a3b8}
        .sp-s8-status.on{color:#0f9d6b;background:#e3f8ef}
        .sp-s8-status.on::before{background:#0f9d6b}
        .sp-s8-plat p{font-size:13.5px;color:#5b6475;min-height:38px;margin:0}
        .sp-s8-plat .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .sp-s8-plat .row .sp-s8-btn{padding:10px 16px;font-size:14px}
        .sp-s8-pick{margin-left:auto;font-size:13px;font-weight:700;color:#5b6475;display:flex;align-items:center;gap:8px;white-space:nowrap}
        .sp-s8-pick i{width:22px;height:22px;border-radius:50%;border:2px solid #cbd2e0;display:grid;place-items:center;font-style:normal;color:#fff;font-size:12px}
        .sp-s8-plat.selected .sp-s8-pick{color:#6d28d9}
        .sp-s8-plat.selected .sp-s8-pick i{background:#7c3aed;border-color:#7c3aed}
        .sp-s8-opts{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .sp-s8-opt{border:1.5px solid #e8eaf2;border-radius:18px;padding:18px;display:flex;gap:14px;align-items:center;text-align:left;background:#fff;cursor:pointer;font-family:inherit}
        .sp-s8-opt .oi{font-size:30px}
        .sp-s8-opt b{display:block;font-size:16px;color:#111827}
        .sp-s8-opt span{font-size:13.5px;color:#5b6475}
        .sp-s8-opt .radio{margin-left:auto;width:24px;height:24px;border-radius:50%;border:2px solid #cbd2e0;flex-shrink:0}
        .sp-s8-opt.selected{border-color:#7c3aed;background:#faf7ff;box-shadow:0 0 0 3px rgba(124,58,237,.12)}
        .sp-s8-opt.selected b{color:#6d28d9}
        .sp-s8-opt.selected .radio{border:7px solid #7c3aed}
        .sp-s8-when{display:none;margin-top:14px;gap:12px;grid-template-columns:1fr 1fr}
        .sp-s8-when.show{display:grid}
        .sp-s8-when label{font-size:13px;font-weight:700;color:#5b6475;display:block;margin-bottom:6px}
        .sp-s8-when input{width:100%;font:inherit;padding:12px 14px;border:1px solid #e8eaf2;border-radius:12px;background:#fff;color:#111827}
        .sp-s8-back-row{margin-top:22px}
        .sp-s8-ready-list{margin-top:18px;padding-top:16px;border-top:1px solid #e8eaf2;display:flex;flex-direction:column;gap:10px}
        .sp-s8-ready-list h4{font-size:15px;margin:0 0 2px;color:#111827}
        .sp-s8-ri{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;color:#111827}
        .sp-s8-ri i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:12px;border:1.5px solid #34d399;color:#0f9d6b;flex-shrink:0}
        .sp-s8-ri.warn{color:#92400e}
        .sp-s8-ri.warn i{border-color:#f59e0b;color:#d97706}
        .sp-s8-ri.opt-i i{border-color:#cbd2e0;color:transparent}
        .sp-s8-ri .ri-act{margin-left:auto;font-size:13px;font-weight:700;color:#6d28d9;background:none;border:none;cursor:pointer;font-family:inherit;padding:0}
        .sp-s8-go{margin-top:18px;display:flex;flex-direction:column;gap:10px}
        .sp-s8-go .sp-s8-btn{width:100%}
        .sp-s8-hint{background:#fffbea;border:1px solid #f4e3a1;color:#8a5a00;border-radius:12px;padding:12px 14px;font-size:13.5px;font-weight:600}
        .sp-s8-hint.ok{background:#e3f8ef;border-color:#a7ecd0;color:#0b7a53}
        .sp-s8-collab label{font-weight:700;font-size:14px;display:block;margin-bottom:6px;color:#111827}
        .sp-s8-collab input{width:100%;font:inherit;padding:11px 14px;border:1px solid #e8eaf2;border-radius:12px;background:#fff;color:#111827}
        .sp-s8-collab small{display:block;color:#5b6475;font-size:12.5px;margin-top:6px}
        .sp-s8-whatsapp{margin-top:14px;border:1.5px solid #e8eaf2;border-radius:16px;padding:16px}
        .sp-s8-when-tz{grid-column:1/-1;font-size:12.5px;color:#5b6475;margin-top:2px}
        .sp-s8-err{grid-column:1/-1;font-size:13px;font-weight:700;color:#8a5a00;background:#fffbea;border:1px solid #f4e3a1;border-radius:12px;padding:10px 13px}
        @media(max-width:1024px){.sp-s8-grid{grid-template-columns:1fr}.sp-s8-aside{position:static}}
        @media(max-width:640px){
          .sp-s8-plat-grid,.sp-s8-opts,.sp-s8-when{grid-template-columns:1fr}
          .sp-s8-hero-wrap{flex-wrap:wrap}
          .sp-s8-tag{margin-left:0}
          .sp-s8-h2{white-space:normal;font-size:21px}
          .sp-s8-card-base{padding:18px}
          .sp-s8-card::before{display:none}
        }
        /* ---- Post Summary highlight animation (ported from the reference) ---- */
        @property --sp-s8-a{syntax:"<angle>";inherits:false;initial-value:0deg}
        .sp-s8-card{position:relative;border:0;padding:0;isolation:isolate;overflow:visible;transform-style:preserve-3d;
          animation:spS8In .9s cubic-bezier(.2,.9,.25,1.15) both,spS8Glow 3s ease-in-out infinite;transition:transform .15s ease-out}
        .sp-s8-card::before{content:"";position:absolute;inset:-3px;border-radius:24px;z-index:-2;
          background:conic-gradient(from var(--sp-s8-a),#7c3aed,#ec4899,#f59e0b,#38bdf8,#7c3aed);
          animation:spS8Spin 3.5s linear infinite;filter:blur(.3px)}
        .sp-s8-card::after{content:"";position:absolute;inset:0;border-radius:21px;z-index:-1;background:#fff}
        .sp-s8-card>*{position:relative}
        .sp-s8-hero{position:relative;overflow:hidden;border-radius:21px 21px 0 0;padding:18px 18px 22px;
          background:linear-gradient(135deg,#1e1042,#4c1d95 55%,#7c3aed);color:#fff}
        .sp-s8-hero::after{content:"";position:absolute;top:0;bottom:0;width:60px;left:-80px;
          background:linear-gradient(100deg,transparent,#ffffff66,transparent);transform:skewX(-20deg);
          animation:spS8Sweep 3.6s ease-in-out infinite}
        .sp-s8-blob{position:absolute;border-radius:50%;filter:blur(28px);opacity:.75;mix-blend-mode:screen;pointer-events:none}
        .sp-s8-b1{width:140px;height:140px;background:#ec4899;top:-40px;right:-30px;animation:spS8Drift1 7s ease-in-out infinite}
        .sp-s8-b2{width:120px;height:120px;background:#38bdf8;bottom:-50px;left:-20px;animation:spS8Drift2 8s ease-in-out infinite}
        .sp-s8-b3{width:90px;height:90px;background:#f59e0b;top:30%;left:45%;animation:spS8Drift1 9s ease-in-out infinite reverse;opacity:.5}
        .sp-s8-spark{position:absolute;color:#fff;font-size:16px;opacity:0;animation:spS8Twinkle 3s ease-in-out infinite;pointer-events:none}
        .sp-s8-sp1{top:14%;left:12%}.sp-s8-sp2{top:28%;right:16%;animation-delay:.8s;font-size:22px}
        .sp-s8-sp3{bottom:22%;left:30%;animation-delay:1.6s;font-size:12px}.sp-s8-sp4{bottom:12%;right:10%;animation-delay:2.2s}
        .sp-s8-thumbwrap{display:flex;gap:14px;align-items:center;position:relative}
        .sp-s8-thumb{width:150px;height:110px;border-radius:16px;border:3px solid #ffffffcc;box-shadow:0 14px 30px rgba(0,0,0,.4);
          animation:spS8Float 3.4s ease-in-out infinite;transform:rotate(-3deg);position:relative;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,.14)}
        .sp-s8-thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,#ffffff88 50%,transparent 65%);
          transform:translateX(-120%);animation:spS8Shine 3.6s ease-in-out infinite 1.2s}
        .sp-s8-ring{position:relative;width:78px;height:78px;background:#ffffff1f;border-radius:50%;backdrop-filter:blur(6px);display:grid;place-items:center;flex-shrink:0}
        .sp-s8-ring svg{position:absolute;inset:6px;width:calc(100% - 12px);height:calc(100% - 12px);transform:rotate(-90deg)}
        .sp-s8-ring circle{fill:none;stroke:#ffffff33;stroke-width:3}
        .sp-s8-ring .arc{stroke:#a7f3d0;stroke-linecap:round;stroke-dasharray:97.4;stroke-dashoffset:97.4;
          transition:stroke-dashoffset 1.6s cubic-bezier(.2,.8,.2,1)}
        .sp-s8-ring b{font-size:17px;font-weight:800}
        .sp-s8-live{width:10px;height:10px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 0 #4ade80aa;animation:spS8Pulse 1.8s infinite;flex-shrink:0}
        .sp-s8-badge{display:inline-flex;align-items:center;gap:7px;background:#ffffff1f;border:1px solid #ffffff33;
          border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;color:#fff}
        .sp-s8-edit{display:inline-flex;align-items:center;gap:5px;background:#ffffff1f;border:1px solid #ffffff33;
          border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;margin-left:auto}
        .sp-s8-edit:hover{background:#ffffff33}
        .sp-s8-body{padding:20px 22px 22px}
        .sp-s8-cap{display:block;font-size:15px;line-height:1.5;min-height:66px;color:#111827}
        .sp-s8-cap::after{content:"\u25AD";color:#7C3AED;animation:spS8Blink .8s steps(1) infinite;margin-left:2px}
        .sp-s8-cap.sp-done::after{display:none}
        .sp-s8-ready{animation:spS8Rise .6s both 1.3s}
        .sp-s8-cta-on{animation:spS8Ready 1.6s ease-in-out infinite}
        .sp-s8-res{margin-top:14px;padding-top:14px;border-top:1px solid #e8eaf2;display:flex;flex-direction:column;gap:8px}
        .sp-s8-res-row{display:flex;align-items:center;gap:9px;font-size:13.5px}
        .sp-s8-res-row .ri-act{margin-left:auto}
        @keyframes spS8Spin{to{--sp-s8-a:360deg}}
        @keyframes spS8In{from{opacity:0;transform:translateX(60px) rotateY(-18deg) scale(.92)}to{opacity:1;transform:none}}
        @keyframes spS8Glow{0%,100%{box-shadow:0 10px 34px rgba(124,58,237,.19)}50%{box-shadow:0 16px 60px rgba(236,72,153,.38)}}
        @keyframes spS8Float{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-7px) rotate(-1deg)}}
        @keyframes spS8Sweep{0%,55%{left:-80px}100%{left:120%}}
        @keyframes spS8Shine{0%,40%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
        @keyframes spS8Drift1{0%,100%{transform:translate(0,0)}50%{transform:translate(-30px,25px)}}
        @keyframes spS8Drift2{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-20px)}}
        @keyframes spS8Twinkle{0%,100%{opacity:0;transform:scale(.4) rotate(0)}50%{opacity:1;transform:scale(1.2) rotate(90deg)}}
        @keyframes spS8Blink{50%{opacity:0}}
        @keyframes spS8Pulse{70%{box-shadow:0 0 0 10px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
        @keyframes spS8Rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        @keyframes spS8Ready{0%,100%{box-shadow:0 10px 22px rgba(124,58,237,.27)}50%{box-shadow:0 0 0 6px rgba(124,58,237,.13),0 12px 30px rgba(124,58,237,.53)}}
        @media(prefers-reduced-motion:reduce){
          .sp-s8-card,.sp-s8-card::before,.sp-s8-hero *,.sp-s8-hero::after,.sp-s8-thumb,.sp-s8-thumb::after,
          .sp-s8-live,.sp-s8-ready,.sp-s8-cta-on{animation:none!important}
          .sp-s8-card::before{display:none}
          .sp-s8-cap::after{display:none}
        }
        .sp-plat-tabs{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
        @media(max-width:640px){.sp-plat-tabs{display:flex;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
        .sp-plat-tabs::-webkit-scrollbar{display:none}.sp-plat-tabs>*{flex:0 0 auto;min-width:132px}}
        .sp-plat-tab{flex:1 1 150px;min-width:0;max-width:280px;display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:11px 16px;border-radius:13px;border:1.5px solid #E5E7EB;background:#fff;color:#334155;font-weight:800;font-size:13.5px;text-transform:capitalize;cursor:pointer;font-family:inherit;transition:border-color .18s,background .18s,color .18s,transform .18s}
        .sp-plat-tab:hover{border-color:#C4B5FD;transform:translateY(-1px)}
        .sp-plat-tab img{width:24px;height:24px;border-radius:7px;object-fit:contain}
        .sp-plat-tab.sp-on{border:2px solid #7C3AED;background:#F5F0FF;color:#5B21B6}
        .sp-prev-canvas{position:relative;border-radius:24px;padding:38px 34px;background:linear-gradient(135deg,#7C3AED 0%,#A855F7 26%,#D946EF 52%,#FB7185 74%,#FBBF24 100%);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,0.35)}
        .sp-prev-viewport{overflow:hidden;touch-action:pan-y}
        .sp-prev-track{display:flex;transition:transform 0.3s cubic-bezier(.22,1,.36,1)}
        .sp-prev-slide{flex:0 0 100%;min-width:0;display:flex;justify-content:center}
        .sp-prev-arrow{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:none;background:#fff;color:#1E293B;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:3;box-shadow:0 6px 18px rgba(15,23,42,0.22);transition:transform .18s,box-shadow .18s}
        .sp-prev-arrow:hover{transform:translateY(-50%) scale(1.08);box-shadow:0 10px 26px rgba(15,23,42,0.3)}
        @media(max-width:640px){.sp-prev-canvas{padding:24px 18px;border-radius:18px}.sp-prev-arrow{width:34px;height:34px;font-size:17px}}
        .sp-prev-dots{display:flex;gap:7px;justify-content:center;margin-top:16px}
        .sp-prev-dot{width:9px;height:9px;border-radius:999px;border:none;padding:0;background:#D1D5DB;cursor:pointer;transition:background .18s,transform .18s}
        .sp-prev-dot.sp-on{background:#7C3AED;transform:scale(1.15)}
        .sp-panel-btn{display:flex;align-items:center;gap:10px;width:100%;padding:14px 18px;border-radius:14px;border:1px solid #E5E7EB;background:#fff;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:800;color:#334155;text-align:left}
        .sp-panel-btn:hover{border-color:#C4B5FD;background:#FAF8FF}
        .sp-duo2{display:grid;gap:20px 28px;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;min-width:0}
        .sp-duo2side{min-width:0;max-width:100%}
        @media(min-width:700px){.sp-duo2side + .sp-duo2side{border-left:1px solid #F1F3F9;padding-left:28px}}
        @media(max-width:699px){.sp-duo2{grid-template-columns:minmax(0,1fr)}.sp-duo2side + .sp-duo2side{border-top:1px solid #F1F3F9;padding-top:20px}}
        .sp-orbit { position: absolute; left: 50%; top: 50%; width: 150px; height: 150px; margin-left: -75px; margin-top: -75px; border: 1.5px dashed rgba(124,58,237,.35); border-radius: 50%; pointer-events: none; animation: spSpinSlow 24s linear infinite; }
        @keyframes spDriftLi { 0%,100% { transform: translate(0,0) rotate(-3deg); } 50% { transform: translate(9px,10px) rotate(3deg); } }
        @keyframes spDriftIg { 0%,100% { transform: translate(0,0) rotate(3deg); } 50% { transform: translate(-9px,10px) rotate(-3deg); } }
        @keyframes spFloatY { 0%,100% { transform: translateY(-5px); } 50% { transform: translateY(6px); } }
        @keyframes spFloatDiag { 0%,100% { transform: translate(-4px,-4px); } 50% { transform: translate(6px,6px); } }
        @keyframes spBreathe { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-5px) scale(1.03); } }
        @keyframes spSpinSlow { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .sp-soc, .sp-robot, .sp-orbit, .sp-cloud, .sp-spin { animation: none !important; transition: none !important; } }
        .sp-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spRot .8s linear infinite;vertical-align:-2px;margin-right:6px}
        @keyframes spRot{to{transform:rotate(360deg)}}
        /* --- Step 3 generation panel (light adaptation of the generation
               concept: orb, sparks, progress, stages, skeleton) --- */
        .sp-ptabs{scrollbar-width:none;-ms-overflow-style:none}
        .sp-ptabs::-webkit-scrollbar{display:none}
        /* Hashtag remove control: small red circle overlapping the chip corner. */
        .sp-tagx{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;background:#DC2626;color:#fff;border:2px solid #fff;font-size:11px;font-weight:800;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;box-shadow:0 2px 6px rgba(0,0,0,.25);transition:background 160ms ease,transform 160ms ease,box-shadow 160ms ease}
        .sp-tagx:hover{background:#B91C1C;transform:scale(1.08);box-shadow:0 3px 10px rgba(220,38,38,.4)}
        .sp-tagx:focus-visible{outline:2px solid #7C3AED;outline-offset:1px}
        .sp-orb{width:54px;height:54px;border-radius:50%;flex-shrink:0;position:relative;background:conic-gradient(from 0deg,#8B5CF6,#EC4899,#22D3EE,#8B5CF6);box-shadow:0 0 28px rgba(139,92,246,.45),0 0 60px rgba(34,211,238,.14);animation:spOrbFloat 2.5s ease-in-out infinite}
        .sp-orb::after{content:"";position:absolute;inset:6px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#2A2140,#120E24 70%)}
        @keyframes spOrbFloat{50%{transform:translateY(-4px) scale(1.04)}}
        .sp-spark{position:absolute;width:5px;height:5px;border-radius:50%;background:#22D3EE;opacity:0;animation:spSparkRise 2.2s infinite;pointer-events:none}
        @keyframes spSparkRise{0%,100%{opacity:0;transform:translateY(6px) scale(.4)}45%{opacity:.9;transform:translateY(-4px) scale(1)}}
        .sp-pfill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#7C3AED,#EC4899,#22D3EE);transition:width .25s ease}
        .sp-stage-dot{width:9px;height:9px;border-radius:50%;background:#CBD5E1;flex-shrink:0}
        .sp-stage-on .sp-stage-dot{background:#8B5CF6;box-shadow:0 0 0 5px rgba(139,92,246,.14),0 0 14px rgba(139,92,246,.7);animation:spPulseDot 1.2s infinite}
        @keyframes spPulseDot{50%{transform:scale(1.25);opacity:.75}}
        .sp-skel{height:13px;border-radius:8px;background:linear-gradient(90deg,#ECE7FA 25%,#F7F3FF 37%,#ECE7FA 63%);background-size:400% 100%;animation:spShimmer 1.3s infinite}
        @keyframes spShimmer{0%{background-position:100% 0}100%{background-position:0 0}}
        .sp-gen-stages{display:grid;gap:8px;margin-top:14px}
        @media(min-width:640px){.sp-gen-stages{grid-template-columns:1fr 1fr}}
        .sp-robot-logo{background:transparent !important;box-shadow:0 10px 28px rgba(15,23,42,.35);overflow:hidden}
        .sp-robot-logo img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}
        .sp-orb-img{width:54px;height:54px;border-radius:50%;object-fit:cover;flex-shrink:0;box-shadow:0 0 28px rgba(139,92,246,.45),0 0 60px rgba(34,211,238,.14);animation:spOrbFloat 2.5s ease-in-out infinite;display:block}
        @media (prefers-reduced-motion: reduce) { .sp-orb,.sp-orb-img,.sp-skel,.sp-stage-on .sp-stage-dot,.sp-spark,.sp-pfill { animation: none !important; transition: none !important; } }
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
        .sp-step7-grid > *, .sp-prev-trio > *, .sp-tone-grid > *, .sp-plat-grid > *, .sp-size-grid > * { min-width: 0; max-width: 100%; }
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
                  <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /><img src="/brand-icons/linkedin.webp" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#0A66C2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /><img src="/brand-icons/instagram.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#E1306C'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /><img src="/brand-icons/facebook.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#1877F2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /><img src="/brand-icons/whatsapp.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#25D366'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-robot sp-robot-logo" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}><img src="/sp-logo.png" alt="SocialPulse AI" width={74} height={74} /></span>
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
            {/* ============ LEFT — CONTENT STYLE & PLATFORM CARD ============ */}
            <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>⚙️</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Content Style &amp; Platform Preference</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>Choose the tone and platforms for your content.</div>
                </div>
              </div>

              <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, letterSpacing: '0.04em' }}>SET TONE OF YOUR CONTENT</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 12 }}>Choose the tone that matches your brand voice and audience.</div>
              <div className="sp-tone-grid">
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

              {/* Image Style + Aspect Ratio live in Step 4 — Media (moved out of Settings). */}
              <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, letterSpacing: '0.04em' }}>SELECT PLATFORMS FOR THIS CONTENT</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 12 }}>Choose where you want this content to be created for.</div>
              <div className="sp-plat-grid">
                {([
                  { id: 'linkedin', label: 'LinkedIn' },
                  { id: 'facebook', label: 'Facebook' },
                  { id: 'instagram', label: 'Instagram' },
                  { id: 'whatsapp', label: 'WhatsApp' },
                ] as const).map(cfg => {
                  // Content-generation selection ONLY (multi-select). Connection
                  // state lives in Publish — never shown or toggled here.
                  const selected = p.selectedPlatforms.includes(cfg.id);
                  const brand = p.platformColors[cfg.id] || C.primary;
                  return (
                    <button
                      key={cfg.id}
                      onClick={() => p.togglePlatform(cfg.id)}
                      aria-pressed={selected}
                      aria-label={`Select ${cfg.label} for content generation`}
                      className="sp-s2-opt"
                      style={selectCardPremium(selected)}
                    >
                      <span style={{
                        position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 7,
                        border: selected ? `2px solid ${C.primary}` : `1.5px solid #CBD5E1`,
                        backgroundColor: selected ? C.primary : '#fff', color: '#fff', fontSize: 11, fontWeight: 800,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>{selected ? '✓' : ''}</span>
                      <span style={{ position: 'relative', width: 42, height: 42, borderRadius: 12, backgroundColor: '#fff', border: '1px solid #EDE9FE', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                        <p.PlatformIcon platform={cfg.id} size={20} />
                        <img src={PLATFORM_IMGS[cfg.id]} alt="" aria-hidden="true" width={34} height={34} style={{ position: 'absolute', top: 4, left: 4, width: 'calc(100% - 8px)', height: 'calc(100% - 8px)', objectFit: 'contain' }} onError={e => { const s = e.currentTarget.parentElement; if (s) s.style.background = brand; e.currentTarget.style.display = 'none'; }} />
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: selected ? C.primaryDark : C.ink }}>{cfg.label}</span>
                      <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{PLATFORM_DESCS[cfg.id]}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}`, flexWrap: 'wrap' }}>
                <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => {
                  // Validate, then move immediately — generation itself starts
                  // on Step 3, so navigation never waits for the AI.
                  if (!p.tone || p.selectedPlatforms.length === 0 || !hasTopic) { setGenBlockerFlash(true); return; }
                  setGenBlockerFlash(false);
                  goNext();
                }} title={(!p.tone || p.selectedPlatforms.length === 0 || !hasTopic) ? genContentBlocker : 'Continue to Step 3 — content generates there'} style={{ minHeight: 50, padding: '14px 24px', borderRadius: 12, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Continue to Generate Content →</button>
              </div>
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
              <div style={{ borderRadius: 20, background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <div className="sp-soc-visual" aria-hidden="true">
                  <span className="sp-orbit" />
                  <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /><img src="/brand-icons/linkedin.webp" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#0A66C2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /><img src="/brand-icons/instagram.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#E1306C'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /><img src="/brand-icons/facebook.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#1877F2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /><img src="/brand-icons/whatsapp.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#25D366'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-robot sp-robot-logo" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}><img src="/sp-logo.png" alt="SocialPulse AI" width={74} height={74} /></span>
                </div>
                <div style={{ padding: '18px 16px 20px', borderTop: '1px solid rgba(233,213,255,0.7)' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>Shape the voice of your content</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.65 }}>Choose the right tone and platforms before generating content.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, textAlign: 'left' }}>
                    {['Right tone', 'Selected platforms', 'Ready for generation'].map(b => (
                      <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ ...card, borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Current Selection</div>
                  <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ border: 'none', background: 'none', color: C.primary, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0 4px 8px' }}>Edit</button>
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2, marginBottom: 12 }}>Your choices for content generation</div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: C.faint }}>TONE</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 4 }}>{p.tone}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: C.faint }}>PLATFORMS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {(['linkedin', 'facebook', 'instagram', 'whatsapp'] as const)
                      .filter(pl => p.selectedPlatforms.includes(pl))
                      .map(pl => (
                        <span key={pl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', borderRadius: 999, backgroundColor: '#F6F1FF', border: '1px solid #E4DBFF', fontSize: 12, fontWeight: 700, color: C.primaryDark }}>
                          <span style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: p.platformColors[pl] || C.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <p.PlatformIcon platform={pl} size={10} />
                          </span>
                          {PLATFORM_LABELS[pl] || pl}
                        </span>
                      ))}
                    {p.selectedPlatforms.length === 0 && (
                      <span style={{ fontSize: 12, color: C.muted }}>No platforms selected</span>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 3 — CONTENT ================= */}
        {currentStep === 3 && (
          <div className="sp-s2-grid">
            {/* ============ LEFT — GENERATED CONTENT CARD ============ */}
            <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6, flexWrap: 'wrap' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>✨</div>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Generated Content &amp; Hashtags</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Review, edit or regenerate your platform-ready content.</div>
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

              {p.generationError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', borderRadius: 12, marginTop: 14 }}>
                  <span style={{ flex: 1 }}>⚠️ {p.generationError}</span>
                  <button onClick={() => p.setGenerationError('')} style={{ border: 'none', background: 'none', color: '#B91C1C', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '0 2px' }}>×</button>
                </div>
              )}
              {(genStage === 'generating' || genStage === 'finishing' || step3NeedsGen) ? (
                <div style={{ border: '1.5px solid #E4DBFF', borderRadius: 16, background: 'linear-gradient(180deg,#FBFAFF,#F6F1FF)', padding: '18px 20px', marginTop: 14, position: 'relative', overflow: 'hidden' }}>
                  <span className="sp-spark" style={{ left: '20%', top: '30%' }} />
                  <span className="sp-spark" style={{ left: '45%', top: '70%', animationDelay: '.7s' }} />
                  <span className="sp-spark" style={{ left: '68%', top: '25%', animationDelay: '1.1s' }} />
                  <span className="sp-spark" style={{ left: '86%', top: '65%', animationDelay: '1.6s' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <img className="sp-orb-img" src="/sp-logo.png" alt="" aria-hidden="true" width={54} height={54} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>✨ SocialPulse AI</div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginTop: 2 }}>{genPhaseShownSafe[0]}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{genPhaseShownSafe[1]}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: C.primaryDark, flexShrink: 0 }}>{Math.floor(genPct)}%</div>
                  </div>
                  <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(genPct)} aria-label="Generation progress" style={{ height: 7, borderRadius: 99, background: '#E7E0FA', overflow: 'hidden', marginTop: 14 }}>
                    <div className="sp-pfill" style={{ width: `${genPct}%` }} />
                  </div>
                  <div className="sp-gen-stages">
                    {GEN_PHASES.map((ph, i) => (
                      <div key={ph[0]} className={i === genPhaseShown ? 'sp-stage-on' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, fontSize: 12.5, fontWeight: 600, color: i < genPhaseShown || genPct >= 100 ? '#059669' : i === genPhaseShown ? C.ink : C.faint, borderWidth: '1.5px', borderStyle: 'solid', borderColor: 'transparent', ...(i === genPhaseShown && genPct < 100 ? { backgroundColor: '#fff', borderColor: '#DDD0FA', boxShadow: '0 2px 10px rgba(124,58,237,0.12)' } : {}) }}>
                        <span className="sp-stage-dot" style={i < genPhaseShown || genPct >= 100 ? { backgroundColor: '#059669' } : {}} />
                        <span>{i < genPhaseShown || genPct >= 100 ? '✓ ' : ''}{ph[0]}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gap: 10, marginTop: 14 }} aria-hidden="true">
                    <div className="sp-skel" style={{ width: '100%' }} />
                    <div className="sp-skel" style={{ width: '92%' }} />
                    <div className="sp-skel" style={{ width: '78%' }} />
                    <div className="sp-skel" style={{ width: '86%' }} />
                    <div className="sp-skel" style={{ width: '64%' }} />
                  </div>
                  {genStage === 'finishing' && genPct >= 100 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, fontWeight: 700, color: '#059669' }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>✓</span>
                      Content ready
                    </div>
                  )}
                </div>
              ) : genStage === 'error' ? (
                <div style={{ border: '1.5px solid #FECACA', borderRadius: 16, backgroundColor: '#FEF2F2', padding: '18px 20px', marginTop: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#B91C1C' }}>Generation failed</div>
                  <div style={{ fontSize: 12.5, color: '#7F1D1D', marginTop: 4, lineHeight: 1.6 }}>{p.generationError || 'The AI service did not respond. Your previous content (if any) is untouched.'}</div>
                  <button onClick={() => { if (!p.isGeneratingContent && canGenContent) p.generateContent(); }} disabled={p.isGeneratingContent || !canGenContent} title={!canGenContent ? genContentBlocker : 'Try generating again'} style={{ marginTop: 12, minHeight: 42, padding: '10px 22px', borderRadius: 11, fontSize: 12.5, fontWeight: 800, border: 'none', cursor: (p.isGeneratingContent || !canGenContent) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', background: (p.isGeneratingContent || !canGenContent) ? '#E8EAF1' : 'linear-gradient(135deg,#7C3AED,#A855F7)', color: (p.isGeneratingContent || !canGenContent) ? '#B6BDCC' : '#fff' }}>↻ Retry</button>
                </div>
              ) : !p.content.trim() ? (
                <div style={{ border: '2px dashed #C4B5FD', borderRadius: 16, backgroundColor: '#FAF8FF', padding: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: 34 }}>📝</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 10 }}>No content yet</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>Go back to Settings and click Continue to Generate Content.</div>
                  <button onClick={() => setCurrentStep(2)} style={{ ...primaryBtn(false), width: 'auto', marginTop: 16, padding: '12px 24px' }}>← Back to Settings</button>
                </div>
              ) : (
                <div>
                  <div className="sp-ptabs" role="tablist" aria-label="Platform content" style={{ display: 'flex', gap: 6, margin: '14px 0 4px', overflowX: 'auto', paddingBottom: 4 }}>
                    {p.selectedPlatforms.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: '10px 12px' }}>Select platforms in Step 2 first.</div>}
                    {p.selectedPlatforms.map(pl => {
                      const on = pl === p.activePreviewPlatform;
                      return (
                        <button key={pl} role="tab" aria-selected={on} onClick={() => p.switchPreviewPlatform(pl)} style={{ flexShrink: 0, padding: '8px 18px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', border: on ? `1.5px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: on ? C.primarySoft : '#fff', color: on ? C.primaryDark : C.muted }}>{PLATFORM_LABELS[pl] || pl}</button>
                      );
                    })}
                  </div>
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
                        <button onClick={() => setCurrentStep(2)} title="Change tone in Settings" style={{ padding: '10px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, border: '1.5px solid #FDE68A', backgroundColor: '#FFFBEB', color: '#92400E', cursor: 'pointer', fontFamily: 'inherit' }}>💼 Tone: {p.tone}</button>
                      </div>
                  {p.activePreviewPlatform !== 'whatsapp' && (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, margin: '20px 0 4px' }}>HASHTAGS</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 14px' }}>
                        {chipTags.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>Hashtags appear here after generation.</span>}
                        {chipTags.map((t) => {
                          const tagText = '#' + String(t).replace(/^#+/, '');
                          const inCaption = p.content.includes(tagText);
                          return (
                            <span key={tagText} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, backgroundColor: inCaption ? C.primary : C.primarySoft, color: inCaption ? '#fff' : C.primaryDark, border: `1.5px solid ${inCaption ? C.primary : C.primaryBorder}`, padding: '7px 14px', borderRadius: 999, boxShadow: inCaption ? '0 3px 10px rgba(124,58,237,0.3)' : 'none' }}>
                              {tagText}{inCaption ? ' ✓' : ''}
                              <button
                                onClick={() => {
                                  if (p.activePreviewPlatform === 'whatsapp') return;
                                  // Remove from the caption …
                                  const v = p.content.split(tagText).join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
                                  p.setContent(v);
                                  // … and from this platform's hashtag list, so the
                                  // chip itself disappears. Regenerating restores it.
                                  if (p.activePreviewPlatform && p.platformContent[p.activePreviewPlatform]) {
                                    const cur = p.platformContent[p.activePreviewPlatform];
                                    const bare = tagText.slice(1).toLowerCase();
                                    p.setPlatformContent({
                                      ...p.platformContent,
                                      [p.activePreviewPlatform]: {
                                        ...cur,
                                        caption: v.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim(),
                                        hashtags: (cur.hashtags || []).filter(h => String(h).replace(/^#+/, '').toLowerCase() !== bare),
                                      },
                                    });
                                  }
                                }}
                                title="Remove hashtag"
                                aria-label={`Remove ${tagText}`}
                                className="sp-tagx"
                              >×</button>
                            </span>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="Add a hashtag…" aria-label="Add a hashtag" style={{ flex: '1 1 140px', minWidth: 0, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', color: C.ink }} />
                        <button onClick={addTag} style={{ ...ghostBtn, minHeight: 40, fontSize: 12.5, padding: '9px 18px' }}>Add</button>
                      </div>
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>Click × on a hashtag to remove it from your caption.</div>
                    </div>
                  )}
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
              <div style={{ borderRadius: 20, background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <div className="sp-soc-visual" aria-hidden="true">
                  <span className="sp-orbit" />
                  <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /><img src="/brand-icons/linkedin.webp" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#0A66C2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /><img src="/brand-icons/instagram.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#E1306C'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /><img src="/brand-icons/facebook.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#1877F2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /><img src="/brand-icons/whatsapp.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#25D366'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-robot sp-robot-logo" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}><img src="/sp-logo.png" alt="SocialPulse AI" width={74} height={74} /></span>
                </div>
                <div style={{ padding: '18px 16px 20px', borderTop: '1px solid rgba(233,213,255,0.7)' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>Turn Ideas Into Content</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.65 }}>AI is shaping your idea into platform-ready content.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, textAlign: 'left' }}>
                    {['Tone applied', 'Platforms optimized', 'Content generated'].map(b => (
                      <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ ...card, borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Content Summary</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: C.faint }}>TONE</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{p.tone}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: C.faint }}>PLATFORM</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{PLATFORM_LABELS[p.activePreviewPlatform] || p.activePreviewPlatform}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: C.faint }}>STATUS</span>
                  {p.isGeneratingContent
                    ? <span style={{ fontSize: 12.5, fontWeight: 700, color: C.primaryDark }}>Generating…</span>
                    : hasContent
                      ? <span style={{ fontSize: 12.5, fontWeight: 700, color: '#059669' }}>Generated</span>
                      : <span style={{ fontSize: 12.5, fontWeight: 700, color: C.faint }}>Waiting</span>}
                </div>
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
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Image Generation</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Create or select visuals for your post.</div>
                </div>
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
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>Tell AI what you want the image to look like. You can edit this anytime.</div>
                {(() => {
                  const derived = p.content.trim().split('\n')[0].substring(0, 200) || p.prompt.trim();
                  // Display falls back to the AI-derived suggestion, but every
                  // keystroke is owned by the user via imagePrompt — the field
                  // is never overwritten except by Reset below.
                  const shown = p.imagePrompt || derived;
                  return (
                    <>
                      <textarea
                        ref={promptInputRef}
                        value={shown}
                        onChange={e => { p.setImagePrompt(e.target.value.slice(0, 500)); }}
                        maxLength={500}
                        placeholder="e.g. A modern professional workspace with a laptop, creative lighting, and a futuristic technology feel…"
                        className="sp-s1-ta"
                        style={{ width: '100%', boxSizing: 'border-box', minHeight: 120, padding: '16px 18px', border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 13.5, lineHeight: 1.7, color: C.ink, backgroundColor: '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                        <span style={{ fontSize: 11.5, color: C.faint, fontWeight: 600 }}>{shown.length} / 500</span>
                        <span style={{ flex: 1 }} />
                        <button onClick={() => p.setImagePrompt('')} title="Restore the AI-derived prompt suggestion" style={{ border: 'none', background: 'none', color: C.primaryDark, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: '6px 4px' }}>Reset to AI suggestion</button>
                      </div>
                      {/* Visual settings moved here from Step 2 — aspect ratio and
                          image style are chosen where the image is generated. */}
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Choose Image Size</div>
                        <div className="sp-size-grid" style={{ marginTop: 10 }}>
                          {([
                            ['1:1', 'Square', 'Best for Instagram'],
                            ['9:16', 'Portrait', 'Best for Stories & Reels'],
                            ['16:9', 'Wide', 'Best for LinkedIn & Facebook'],
                            ['4:3', 'Standard', 'Good for general posts'],
                          ] as const).filter(([key]) => p.aspectRatioMap[key]).map(([key, name, hint]) => {
                            const active = p.aspectRatio === key;
                            return (
                              <button key={key} onClick={() => p.setAspectRatio(key)} title={`${name} (${key}) — ${hint}`} aria-pressed={active} className="sp-s2-opt" style={{ ...selectCardPremium(active), alignItems: 'center', textAlign: 'center' }}>
                                <span style={checkBadge(active)}>{active ? '✓' : ''}</span>
                                <span style={{
                                  width: key === '1:1' ? 30 : key === '16:9' ? 40 : key === '9:16' ? 22 : 34,
                                  height: key === '1:1' ? 30 : key === '16:9' ? 23 : key === '9:16' ? 36 : 26,
                                  borderRadius: 6, border: `2.5px solid ${active ? C.primary : '#CBD5E1'}`,
                                  backgroundColor: active ? '#fff' : '#F8FAFC', flexShrink: 0, display: 'block',
                                }} />
                                <span style={{ fontSize: 13, fontWeight: 800, color: active ? C.primaryDark : C.ink, marginTop: 6 }}>{name}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: active ? C.primaryDark : C.muted }}>{key}</span>
                                <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{hint}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Choose Visual Style</div>
                        <div className="sp-size-grid" style={{ marginTop: 10 }}>
                          {([
                            ['Photographic', '📷', 'Real Photo', 'Natural and realistic'],
                            ['Digital Art', '🎨', 'Creative Art', 'Designed and illustrated'],
                            ['Cinematic', '🎬', 'Cinematic', 'Dramatic and polished'],
                            ['Anime', '🖌', 'Illustration', 'Stylized and artistic'],
                          ] as const).map(([value, icon, label, desc]) => {
                            const active = p.imageStyle === value;
                            return (
                              <button key={value} onClick={() => p.setImageStyle(value)} title={`${label} — ${desc}`} aria-pressed={active} className="sp-s2-opt" style={selectCardPremium(active)}>
                                <span style={checkBadge(active)}>{active ? '✓' : ''}</span>
                                <span style={{ fontSize: 24 }}>{icon}</span>
                                <span style={{ fontSize: 13, fontWeight: 800, color: active ? C.primaryDark : C.ink }}>{label}</span>
                                <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{desc}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                        <button
                          onClick={p.generateImage}
                          disabled={p.isGeneratingImage || !shown.trim() || !p.aspectRatio || !p.imageStyle || !canGenImage}
                          aria-disabled={p.isGeneratingImage || !shown.trim() || !p.aspectRatio || !p.imageStyle || !canGenImage}
                          title={p.isGeneratingImage ? 'Generating — please wait' : !shown.trim() ? 'Describe your visual above first' : !p.aspectRatio ? 'Select an aspect ratio above first' : !p.imageStyle ? 'Choose an image style above first' : !canGenImage ? 'Add content first' : (p.generatedImage || p.generatedVideo) ? 'Start a fresh generation with the current prompt and settings' : 'Generate AI image'}
                          style={{ minHeight: 46, padding: '12px 28px', borderRadius: 12, fontSize: 13.5, fontWeight: 800, border: 'none', cursor: (canGenImage && shown.trim() && p.aspectRatio && p.imageStyle) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', flexShrink: 0, background: (canGenImage && shown.trim() && p.aspectRatio && p.imageStyle) ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : '#E4DFF2', color: (canGenImage && shown.trim() && p.aspectRatio && p.imageStyle) ? '#fff' : '#9A8FC7', opacity: (canGenImage && shown.trim() && p.aspectRatio && p.imageStyle) ? 1 : 0.7, boxShadow: (canGenImage && shown.trim() && p.aspectRatio && p.imageStyle) ? '0 6px 20px rgba(124,58,237,0.4)' : 'none' }}
                        >
                          {p.isGeneratingImage
                            ? (<span><span className="sp-spin" aria-hidden="true" />Generating Image…</span>)
                            : !shown.trim() ? 'Enter a Visual Description First'
                            : !p.aspectRatio ? 'Select Aspect Ratio First'
                            : !p.imageStyle ? 'Choose Image Style First'
                            : !canGenImage ? 'Add content first'
                            : (p.generatedImage || p.generatedVideo) ? '🔁 Regenerate Image'
                            : '✨ Generate Image'}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>We’ll use your content and choices to create the image.{!shown.trim() ? ' Enter a visual description above to unlock generation.' : !p.aspectRatio ? ' Select an aspect ratio above to unlock generation.' : !p.imageStyle ? ' Choose an image style above to unlock generation.' : ''}</div>
                    </>
                  );
                })()}
              </div>
            )}
            {mediaTab === 'ai' && (
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, flex: 1 }}>Generated Media</div>
                  {(p.generatedImage || p.generatedVideo) && !p.isGeneratingImage && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '5px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>✓ AI image ready</span>
                  )}
                </div>
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
                      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
                        <button onClick={downloadGeneratedMedia} title="Download" aria-label="Download generated image" style={{ minWidth: 38, height: 38, padding: '0 10px', borderRadius: 10, fontSize: 15, fontWeight: 800, border: '1px solid #E2E8F0', background: 'rgba(255,255,255,0.94)', color: '#0F172A', cursor: 'pointer', fontFamily: 'inherit', backdropFilter: 'blur(6px)', boxShadow: '0 4px 14px rgba(15,23,42,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⬇</button>
                        {!p.generatedVideo && (
                          <button onClick={() => p.clearGeneratedImage()} title="Remove" aria-label="Remove generated image" style={{ minWidth: 38, height: 38, padding: '0 10px', borderRadius: 10, fontSize: 15, fontWeight: 800, border: '1px solid #E2E8F0', background: 'rgba(255,255,255,0.94)', color: '#475569', cursor: 'pointer', fontFamily: 'inherit', backdropFilter: 'blur(6px)', boxShadow: '0 4px 14px rgba(15,23,42,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.16s' }} onMouseEnter={e => { e.currentTarget.style.background = '#FECACA'; e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#FCA5A5'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.94)'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = '#E2E8F0'; }}>🗑</button>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {[
                        `Aspect Ratio: ${p.aspectRatio || '—'}${p.aspectRatio && p.aspectRatioMap[p.aspectRatio] ? ` (${p.aspectRatioMap[p.aspectRatio].label})` : ''}`,
                        `Style: ${p.imageStyle}`,
                        `Size: ${p.aspectRatio && p.aspectRatioMap[p.aspectRatio] ? `${p.aspectRatioMap[p.aspectRatio].width}×${p.aspectRatioMap[p.aspectRatio].height}` : '—'}`,
                      ].map(d => (
                        <span key={d} style={{ fontSize: 10.5, fontWeight: 700, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '4px 10px', borderRadius: 999 }}>{d}</span>
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
                <button onClick={goNext} style={{ minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Next →</button>
              </div>
            </div>
            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ borderRadius: 20, background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <div className="sp-soc-visual" aria-hidden="true">
                  <span className="sp-orbit" />
                  <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /><img src="/brand-icons/linkedin.webp" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#0A66C2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /><img src="/brand-icons/instagram.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#E1306C'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /><img src="/brand-icons/facebook.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#1877F2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /><img src="/brand-icons/whatsapp.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#25D366'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-robot sp-robot-logo" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}><img src="/sp-logo.png" alt="SocialPulse AI" width={74} height={74} /></span>
                </div>
                <div style={{ padding: '18px 16px 20px', borderTop: '1px solid rgba(233,213,255,0.7)' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>Bring Your Visual To Life ✨</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.65 }}>AI turns your content into a visual that matches your tone, platform and style.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, textAlign: 'left' }}>
                    {['Content understood', 'Style selected', 'Ready to generate'].map(b => (
                      <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ ...card, borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Current Style</div>
                {[
                  ['Tone', p.tone || 'Not set'],
                  ['Image Style', p.imageStyle || 'Not set'],
                  ['Aspect Ratio', p.aspectRatio ? `${p.aspectRatio}${p.aspectRatioMap[p.aspectRatio] ? ` ${p.aspectRatioMap[p.aspectRatio].label}` : ''}` : 'Not set'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: C.faint, letterSpacing: '0.06em' }}>{label.toUpperCase()}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{value}</div>
                  </div>
                ))}
                <button onClick={() => setCurrentStep(2)} style={{ width: '100%', marginTop: 10, padding: '10px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer', fontFamily: 'inherit' }}>Change Settings →</button>
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
                  </div>
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
                    <span style={{ fontSize: 13, fontWeight: 800, color: !p.isCarousel ? C.primaryDark : C.ink }}>Single Image</span>
                    <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Publish one hero visual</span>
                    <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Best for announcements, promotions, quotes, or single-image posts.</span>
                  </button>
                  <button onClick={() => p.setIsCarousel(true)} className="sp-s2-opt" style={selectCardPremium(p.isCarousel)}>
                    <span style={checkBadge(p.isCarousel)}>{p.isCarousel ? '✓' : ''}</span>
                    <span style={{ fontSize: 24 }}>🎠</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: p.isCarousel ? C.primaryDark : C.ink }}>Multiple Images{p.isCarousel ? ` · ${p.carouselSlides.length}` : ''}</span>
                    <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Combine 2–9 images into one swipeable post</span>
                    <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Best for tutorials, step-by-step guides, product showcases, or visual stories.</span>
                  </button>
                </div>
                {p.isCarousel && <div style={{ fontSize: 12, color: C.primaryDark, fontWeight: 700, marginTop: 10 }}>Multiple Images supports 2–9 images.</div>}
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
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginTop: 12 }}>One post, one hero visual — switch to Multiple Images to bundle slides into a swipeable album.</div>
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
                          title={!p.aspectRatio ? 'Select an aspect ratio in the AI panel first' : p.mediaItems.length >= 9 ? 'Gallery is full (max 9)' : 'Generate a full set of carousel slides from your topic'}
                          style={{ padding: '8px 16px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: 'none', background: (p.isGeneratingCarousel || p.isGeneratingImage || !p.aspectRatio || p.mediaItems.length >= 9) ? '#DDD6FE' : 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: (p.isGeneratingCarousel || p.isGeneratingImage || !p.aspectRatio || p.mediaItems.length >= 9) ? 'not-allowed' : 'pointer' }}
                        >
                          {p.isGeneratingCarousel ? 'Generating slides…' : p.isGeneratingImage ? 'Generating…' : `Generate ${p.carouselSlideCount} slides`}
                        </button>
                      </div>
                      {!p.aspectRatio && <div style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>Select an aspect ratio in the AI panel first — slides generate at that size.</div>}
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
                <button onClick={goNext} style={{ minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Next →</button>
              </div>
            </div>
            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ borderRadius: 20, background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <div className="sp-soc-visual" aria-hidden="true">
                  <span className="sp-orbit" />
                  <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /><img src="/brand-icons/linkedin.webp" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#0A66C2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /><img src="/brand-icons/instagram.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#E1306C'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /><img src="/brand-icons/facebook.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#1877F2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /><img src="/brand-icons/whatsapp.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#25D366'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-robot sp-robot-logo" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}><img src="/sp-logo.png" alt="SocialPulse AI" width={74} height={74} /></span>
                </div>
                <div style={{ padding: '18px 16px 20px', borderTop: '1px solid rgba(233,213,255,0.7)' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>Create Beautiful Visuals That Stand Out ✨</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.65 }}>Design. Brand. Publish.</div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 6 — PERSONALIZATION ================= */}
        {currentStep === 6 && (
          <div className="sp-s2-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🎨</div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Personalization</div>
                  </div>
                </div>
              </div>

              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              {/* ---- Sections 1+2: Brand Identity + Describe, side by side ---- */}
              <div className="sp-duo2">
              <div className="sp-duo2side">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Logo & Visual Identity</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Upload your brand logo once and apply it to this image or all images.</div>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Logo</div>
                    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Upload your brand logo once and apply it to this image or all images.</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {p.logoImage
                        ? <img src={p.logoImage} alt="Brand logo" style={{ width: 44, height: 44, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 10, border: `1px solid ${C.border}`, padding: 4 }} />
                        : <img src="/sp-logo.png" alt="SocialPulse" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.border}` }} />}
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
                  </div>
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
              <div className="sp-duo2side">
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Describe Your Image</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Add a short description to help people using screen readers understand your image.</div>
                {altTextControls}
              </div>
              </div>
              </div>

              {/* ---- Section 2: Image Preview ---- */}
              <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Image Preview</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 12 }}>See how your logo looks on your selected image.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
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
                          : <img src={heroUrl} alt={hero?.altText || 'Branded design preview'} onClick={() => setLightboxItem({ url: heroUrl, type: 'image', altText: hero?.altText })} title="Click to zoom" style={{ width: '100%', maxHeight: 380, objectFit: 'contain', display: 'block', backgroundColor: '#0F172A', cursor: 'zoom-in' }} />}
                        {p.logoImage && !p.burnedLogoIds[heroKey] && !heroIsVideo && (
                          <img src={p.logoImage} alt="logo" style={{
                            position: 'absolute', width: `${Math.round(p.logoScale * 100)}%`, maxWidth: '28%', opacity: p.logoOpacity,
                            ...(p.logoPosition === 'top-left' ? { top: 10, left: 10 } : p.logoPosition === 'top-right' ? { top: 10, right: 10 } : p.logoPosition === 'bottom-left' ? { bottom: 54, left: 10 } : p.logoPosition === 'bottom-right' ? { bottom: 54, right: 10 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                            backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6, pointerEvents: 'none',
                          }} />
                        )}
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
                      {(() => {
                        // Apply targets mirror the burn: all image media, or the
                        // single generated visual when the gallery is empty.
                        const imageCount = p.isCarousel
                          ? p.carouselSlides.length
                          : (p.mediaItems.filter(m => m.type === 'image').length || ((p.generatedImage || p.generatedVideo) ? 1 : 0));
                        const heroId = hero && hero.id && p.mediaItems.some(m => m.id === hero.id) ? hero.id : null;
                        const canApply = !!p.logoImage && !p.isApplyingLogo && !!heroUrl && !heroIsVideo;
                        const applyToHero = () => {
                          // Deferred one tick so the target selection above has
                          // committed before the burn reads it (same pattern as
                          // the logo dialog's delayed apply).
                          if (heroId) {
                            p.setLogoTargetId(heroId);
                            setTimeout(() => p.applyLogoToAllMedia(), 60);
                          } else {
                            p.applyLogoToAllMedia();
                          }
                        };
                        const applyToAll = () => {
                          p.setLogoTargetId(null);
                          setTimeout(() => p.applyLogoToAllMedia(), 60);
                        };
                        return (
                          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                            <button onClick={applyToHero} disabled={!canApply} title={!p.logoImage ? 'Upload a brand logo first' : 'Burn the logo into the featured visual'} style={{ flex: 1, minWidth: 150, minHeight: 44, padding: '12px 18px', borderRadius: 12, fontSize: 12.5, fontWeight: 800, border: 'none', cursor: canApply ? 'pointer' : 'not-allowed', fontFamily: 'inherit', background: canApply ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : '#DDD6FE', color: '#fff', boxShadow: canApply ? '0 6px 20px rgba(124,58,237,0.4)' : 'none' }}>
                              {p.isApplyingLogo ? 'Applying…' : 'Apply Logo to This Image'}
                            </button>
                            {imageCount > 1 && (
                              <button onClick={applyToAll} disabled={!canApply} title="Burn the logo into all images" style={{ flex: 1, minWidth: 150, minHeight: 44, padding: '12px 18px', borderRadius: 12, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${C.primary}`, backgroundColor: '#fff', color: C.primaryDark, cursor: canApply ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: canApply ? 1 : 0.6 }}>
                                {p.isApplyingLogo ? 'Applying…' : 'Apply to All Images'}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>


              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2, paddingTop: 20, borderTop: `1px solid ${C.borderSoft}`, flexWrap: 'wrap' }}>
                <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
                <div style={{ flex: 1 }} />
                <button onClick={goNext} style={{ minHeight: 50, padding: '14px 38px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Continue to Preview →</button>
              </div>
            </div>
            {/* ============ RIGHT — AI ASSISTANT PANEL ============ */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ borderRadius: 20, background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                <div className="sp-soc-visual" aria-hidden="true">
                  <span className="sp-orbit" />
                  <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /><img src="/brand-icons/linkedin.webp" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#0A66C2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /><img src="/brand-icons/instagram.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#E1306C'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /><img src="/brand-icons/facebook.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#1877F2'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /><img src="/brand-icons/whatsapp.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#25D366'; e.currentTarget.style.display = 'none'; }} /></span>
                  <span className="sp-robot sp-robot-logo" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}><img src="/sp-logo.png" alt="SocialPulse AI" width={74} height={74} /></span>
                </div>
                <div style={{ padding: '18px 16px 20px', borderTop: '1px solid rgba(233,213,255,0.7)' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>Build a Stronger Brand with AI ✨</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.65 }}>Add your logo to make your content instantly recognizable across all platforms.</div>
                </div>
              </div>

              <div style={{ ...card, borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Accessibility Check</div>
                {(() => {
                  const checkImages = [...p.mediaItems, ...postExtraImages].filter(m => m.type === 'image');
                  const altOk = checkImages.length > 0 && checkImages.every(m => m.altText?.trim());
                  const rows: Array<[string, boolean, string]> = [
                    p.logoImage
                      ? ['Logo is visible', true, '']
                      : ['Logo is optional', false, ''],
                    checkImages.length === 0
                      ? ['No visuals yet', false, '']
                      : altOk
                        ? ['Descriptions added', true, '']
                        : ['Add image description', false, ''],
                    checkImages.length === 0
                      ? ['Waiting for visual', false, '']
                      : ['Preview ready', true, ''],
                  ];
                  return (
                    <div>
                      {rows.map(([label, ok]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                          <span style={{ width: 17, height: 17, borderRadius: '50%', background: ok ? '#ECFDF5' : '#F1F3F9', border: `1px solid ${ok ? '#A7F3D0' : '#E2E8F0'}`, color: ok ? '#059669' : '#B6BDCC', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{ok ? '✓' : '·'}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: ok ? '#334155' : C.faint }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 7 — PREVIEW ================= */}
        {currentStep === 7 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...card, borderRadius: 20, padding: '28px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>👁️</div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>BRANDING PREVIEW</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Preview your branded visual and make final adjustments before publishing.</div>
                </div>
              </div>
            </div>
            <div className="sp-step7-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 11, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>👁️</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>Platform Preview</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>See how your image will look on each platform with your logo.</div>
                </div>
              </div>
              {(() => {
                const hero = p.mediaItems.find(m => m.type === 'image') || p.mediaItems[0] || null;
                const heroUrl = hero?.url || p.generatedImage || p.generatedVideo || '';
                const heroIsVideo = hero ? hero.type === 'video' : !!p.generatedVideo && !hero;
                const heroKey = hero?.id || 'gen';
                const brandIcon: Record<string, string> = { linkedin: '/brand-icons/linkedin.webp', facebook: '/brand-icons/facebook.png', instagram: '/brand-icons/instagram.png', whatsapp: '/brand-icons/whatsapp.png' };
                const previewOpts = (['instagram', 'facebook', 'linkedin', 'whatsapp'] as const).filter(pl => p.selectedPlatforms.includes(pl));
                const safePreviewIdx = Math.min(previewSlideIdx, Math.max(previewOpts.length - 1, 0));
                const capNoTags = (() => { const tags = p.platformContent[p.activePreviewPlatform]?.hashtags || []; if (!p.content.trim()) return ''; return tags.length ? p.content.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim() : p.content; })();
                const waCap = (() => { const c = p.platformContent[p.activePreviewPlatform]?.caption || p.content; return c.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/,'').trim(); })();
                const tagList = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
                const unburnedLogo = p.logoImage && !heroIsVideo && !p.burnedLogoIds[heroKey] ? p.logoImage : undefined;
                const gotoSlide = (nn: number) => {
                  setPreviewSlideIdx(nn);
                  const pl = previewOpts[nn];
                  setPreviewPlatform(pl);
                  if (p.platformContent[pl]) p.switchPreviewPlatform(pl);
                };
                if (previewOpts.length === 0) {
                  return (
                    <div style={{ marginTop: 18, borderRadius: 24, padding: 40, textAlign: 'center', background: 'linear-gradient(135deg,#7C3AED,#D946EF 55%,#FBBF24)' }}>
                      <div style={{ background: '#fff', borderRadius: 20, padding: 30, boxShadow: '0 12px 36px rgba(15,23,42,0.18)' }}>
                        <div style={{ fontSize: 30 }}>📭</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginTop: 8 }}>No platforms selected</div>
                        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>Pick where you want to publish in Settings.</div>
                      </div>
                    </div>
                  );
                }
                if (!heroUrl) {
                  return (
                    <div style={{ marginTop: 18, borderRadius: 24, padding: 54, textAlign: 'center', background: 'linear-gradient(135deg,#7C3AED,#D946EF 55%,#FBBF24)' }}>
                      <div style={{ background: '#fff', borderRadius: 20, padding: 40, boxShadow: '0 12px 36px rgba(15,23,42,0.18)' }}>
                        <div style={{ fontSize: 34 }}>🖼️</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginTop: 8 }}>No visual yet</div>
                        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>Create one in Media (Step 4), then return here.</div>
                      </div>
                    </div>
                  );
                }
                return (
                  <>
                    <div className="sp-plat-tabs" style={{ marginTop: 18 }}>
                      {previewOpts.map((pps, i) => (
                        <button key={pps} className={'sp-plat-tab' + (i === safePreviewIdx ? ' sp-on' : '')} onClick={() => gotoSlide(i)} aria-label={`Preview ${pps}`} aria-pressed={i === safePreviewIdx}>
                          <img src={brandIcon[pps]} alt="" aria-hidden="true" width={24} height={24} />
                          {pps}
                        </button>
                      ))}
                    </div>

                    <div className="sp-prev-canvas">
                      {previewOpts.length > 1 && (
                        <button className="sp-prev-arrow" style={{ left: 14 }} aria-label="Previous platform" onClick={() => gotoSlide((safePreviewIdx - 1 + previewOpts.length) % previewOpts.length)}>‹</button>
                      )}
                      <div className="sp-prev-viewport" onTouchStart={e => { e.currentTarget.dataset.sx = String(e.touches[0].clientX); }} onTouchEnd={e => { const sx = parseFloat(e.currentTarget.dataset.sx || 'x'); if (Number.isNaN(sx) || previewOpts.length < 2) return; const dx = e.changedTouches[0].clientX - sx; delete e.currentTarget.dataset.sx; if (Math.abs(dx) < 40) return; gotoSlide(dx < 0 ? (safePreviewIdx + 1) % previewOpts.length : (safePreviewIdx - 1 + previewOpts.length) % previewOpts.length); }}>
                        <div className="sp-prev-track" style={{ transform: `translateX(-${safePreviewIdx * 100}%)` }}>
                          {previewOpts.map(pps => (
                            <div key={pps} className="sp-prev-slide">
                              <div style={{ width: '100%', maxWidth: pps === 'instagram' ? 430 : pps === 'whatsapp' ? 380 : 560 }}>
                                {pps === 'instagram' ? (
                                  <InstagramPhonePreview
                                    username={(p.accounts.find(a => a.platform === 'instagram' && a.connected) as any)?.instagramUsername || p.accounts.find(a => a.platform === 'instagram' && a.connected)?.name || p.accounts.find(a => a.platform === 'facebook' && a.connected)?.name || 'socialpulse'}
                                    avatarUrl={p.logoImage || undefined}
                                    mediaUrl={heroUrl}
                                    mediaType={heroIsVideo ? 'video' : 'image'}
                                    caption={capNoTags}
                                    hashtags={tagList}
                                    aspectRatio={p.aspectRatio || '1:1'}
                                    logoUrl={unburnedLogo}
                                    logoPosition={p.logoPosition}
                                    logoScale={p.logoScale}
                                    logoOpacity={p.logoOpacity}
                                  />
                                ) : pps === 'facebook' ? (
                                  <FacebookPostPreview
                                    caption={capNoTags}
                                    hashtags={tagList}
                                    mediaUrl={heroUrl}
                                    mediaType={heroIsVideo ? 'video' : 'image'}
                                    pageName="SocialPulse"
                                    avatarUrl={p.logoImage || undefined}
                                    aspectRatio={p.aspectRatio || '1:1'}
                                    logoUrl={unburnedLogo}
                                    logoPosition={p.logoPosition}
                                    logoScale={p.logoScale}
                                    logoOpacity={p.logoOpacity}
                                  />
                                ) : pps === 'linkedin' ? (
                                  <LinkedInPostPreview
                                    caption={capNoTags}
                                    hashtags={tagList}
                                    mediaUrl={heroUrl}
                                    mediaType={heroIsVideo ? 'video' : 'image'}
                                    aspectRatio={p.aspectRatio || '1:1'}
                                    profileName="SocialPulse"
                                    profileSubtitle="Social Media Content Manager"
                                    avatarUrl={p.logoImage || undefined}
                                    logoUrl={unburnedLogo}
                                    logoPosition={p.logoPosition}
                                    logoScale={p.logoScale}
                                    logoOpacity={p.logoOpacity}
                                    burnedIds={p.burnedLogoIds}
                                  />
                                ) : (
                                  <WhatsAppCommunityPreview
                                    communityName={(p.whapiGroups || []).find(g => g.id === p.whapiSelectedGroupId)?.name || 'SocialPulse Testing 🚀'}
                                    subtitle="Announcements"
                                    destinationType={(p.whapiGroups || []).find(g => g.id === p.whapiSelectedGroupId)?.type || 'announcement_group'}
                                    caption={waCap}
                                    hashtags={[]}
                                    mediaUrl={heroUrl}
                                    mediaType={heroIsVideo ? 'video' : 'image'}
                                    aspectRatio={p.aspectRatio || '1:1'}
                                    logoUrl={unburnedLogo}
                                    logoPosition={p.logoPosition}
                                    logoScale={p.logoScale}
                                    logoOpacity={p.logoOpacity}
                                  />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {previewOpts.length > 1 && (
                        <button className="sp-prev-arrow" style={{ right: 14 }} aria-label="Next platform" onClick={() => gotoSlide((safePreviewIdx + 1) % previewOpts.length)}>›</button>
                      )}
                    </div>

                    {previewOpts.length > 1 && (
                      <div className="sp-prev-dots">
                        {previewOpts.map((pps, i) => (
                          <button key={pps} aria-label={`Go to ${pps} preview`} className={'sp-prev-dot' + (i === safePreviewIdx ? ' sp-on' : '')} onClick={() => gotoSlide(i)} />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <button className="sp-panel-btn" onClick={() => setBrandPanelOpen(o => !o)} aria-expanded={brandPanelOpen}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: '#EDE9FE', border: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🎨</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5 }}>Logo &amp; Image Description</span>
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 1 }}>Upload or replace your logo, set its placement, and write ALT text.</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.primaryDark, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>{brandPanelOpen ? 'Hide' : 'Edit'}<span style={{ display: 'inline-block', transition: 'transform .2s', transform: brandPanelOpen ? 'rotate(180deg)' : 'none' }}>⌄</span></span>
            </button>

            {brandPanelOpen && (
                    <div style={{ ...card, borderRadius: 20, padding: '24px 26px', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 36px rgba(15,23,42,0.08)' }}>
                    {/* ---- Sections 1+2: Brand Identity + Describe, side by side ---- */}
                    <div className="sp-duo2">
                    <div className="sp-duo2side">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Logo & Visual Identity</div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Upload your brand logo once and apply it to this image or all images.</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, backgroundColor: '#FCFCFE', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand Logo</div>
                          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>Upload your brand logo once and apply it to this image or all images.</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {p.logoImage
                              ? <img src={p.logoImage} alt="Brand logo" style={{ width: 44, height: 44, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 10, border: `1px solid ${C.border}`, padding: 4 }} />
                              : <img src="/sp-logo.png" alt="SocialPulse" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.border}` }} />}
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
                        </div>
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
                    <div className="sp-duo2side">
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Describe Your Image</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Add a short description to help people using screen readers understand your image.</div>
                      {altTextControls}
                    </div>
                    </div>
                    </div>
            )}



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
              <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <div style={{ borderRadius: 20, background: 'linear-gradient(135deg,#EDE9FE 0%,#FCE7F3 100%)', border: '1px solid #E9D5FF', overflow: 'hidden', textAlign: 'center' }}>
                  <div className="sp-soc-visual" aria-hidden="true">
                    <span className="sp-orbit" />
                    <span className="sp-soc" title="LinkedIn" style={{ left: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(10,102,194,0.4)', animation: 'spDriftLi 6.5s ease-in-out infinite' }}><p.PlatformIcon platform="linkedin" size={22} /><img src="/brand-icons/linkedin.webp" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#0A66C2'; e.currentTarget.style.display = 'none'; }} /></span>
                    <span className="sp-soc" title="Instagram" style={{ right: '11%', top: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(209,42,123,0.4)', animation: 'spDriftIg 7.2s ease-in-out infinite', animationDelay: '0.8s' }}><p.PlatformIcon platform="instagram" size={22} /><img src="/brand-icons/instagram.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#E1306C'; e.currentTarget.style.display = 'none'; }} /></span>
                    <span className="sp-soc" title="Facebook" style={{ left: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(24,119,242,0.4)', animation: 'spFloatY 5.2s ease-in-out infinite', animationDelay: '0.3s' }}><p.PlatformIcon platform="facebook" size={22} /><img src="/brand-icons/facebook.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#1877F2'; e.currentTarget.style.display = 'none'; }} /></span>
                    <span className="sp-soc" title="WhatsApp" style={{ right: '15%', bottom: 16, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(37,211,102,0.42)', animation: 'spFloatDiag 6s ease-in-out infinite', animationDelay: '1.4s' }}><p.PlatformIcon platform="whatsapp" size={22} /><img src="/brand-icons/whatsapp.png" alt="" aria-hidden="true" width={40} height={40} style={{ position: 'absolute', top: 6, left: 6, width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', objectFit: 'contain' }} onError={e => { const b = e.currentTarget.parentElement; if (b) b.style.background = '#25D366'; e.currentTarget.style.display = 'none'; }} /></span>
                    <span className="sp-robot sp-robot-logo" style={{ animation: 'spBreathe 5.5s ease-in-out infinite' }}><img src="/sp-logo.png" alt="SocialPulse AI" width={74} height={74} /></span>
                  </div>
                  <div style={{ padding: '18px 16px 20px', borderTop: '1px solid rgba(233,213,255,0.7)' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>Build a Stronger Brand with AI ✨</div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.65 }}>Add your logo to make your content instantly recognizable across all platforms.</div>
                  </div>
                </div>

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
                <div style={{ ...card, borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Accessibility Check</div>
                  {(() => {
                    const checkImages = [...p.mediaItems, ...postExtraImages].filter(m => m.type === 'image');
                    const altOk = checkImages.length > 0 && checkImages.every(m => m.altText?.trim());
                    const rows: Array<[string, boolean, string]> = [
                      p.logoImage
                        ? ['Logo is visible', true, '']
                        : ['Logo is optional', false, ''],
                      checkImages.length === 0
                        ? ['No visuals yet', false, '']
                        : altOk
                          ? ['Descriptions added', true, '']
                          : ['Add image description', false, ''],
                      checkImages.length === 0
                        ? ['Waiting for visual', false, '']
                        : ['Preview ready', true, ''],
                    ];
                    return (
                      <div>
                        {rows.map(([label, ok]) => (
                          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                            <span style={{ width: 17, height: 17, borderRadius: '50%', background: ok ? '#ECFDF5' : '#F1F3F9', border: `1px solid ${ok ? '#A7F3D0' : '#E2E8F0'}`, color: ok ? '#059669' : '#B6BDCC', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{ok ? '✓' : '·'}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: ok ? '#334155' : C.faint }}>{label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

              </aside>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14 }}>← Back</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowCancelPreview(true)} style={{ ...ghostBtn, minHeight: 50, padding: '14px 26px', fontSize: 14, color: '#B91C1C' }}>Cancel</button>
              <button onClick={goNext} style={{ minHeight: 50, padding: '14px 34px', borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', boxShadow: '0 6px 22px rgba(124,58,237,0.42)' }}>Publish →</button>
            </div>
          </div>
        )}

                {/* ================= STEP 8 — PUBLISH ================= */}
        {currentStep === 8 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="sp-s8-grid">
              {/* ================= LEFT STACK ================= */}
              <div className="sp-s8-stack">
                {/* hero */}
                <section className="sp-s8-card-base">
                  <div className="sp-s8-hero-wrap">
                    <div className="sp-s8-ico">✈️</div>
                    <div>
                      <h2 className="sp-s8-h2">Publish Your Post</h2>
                      <p style={{ color: '#5b6475', margin: '4px 0 0', fontSize: 14 }}>Your content is ready. Choose where and when you want to publish.</p>
                    </div>
                    <div className="sp-s8-tag">
                      👑 Great content is meant to be shared!
                      <small>Choose your platform and timing.</small>
                    </div>
                  </div>
                </section>

                {/* 1 — WHERE */}
                <section className="sp-s8-card-base">
                  <div className="sp-s8-sec">
                    <div className="sp-s8-num">1</div>
                    <div>
                      <h3>Choose where to publish</h3>
                      <p className="sub">Select the platforms you want to publish this post to. Connect any account that isn’t linked yet.</p>
                    </div>
                    <button className="sp-s8-btn ghost" onClick={p.refreshWhapiStatus} disabled={p.whapiLoading} aria-label="Refresh connection status">↻ Refresh</button>
                  </div>

                  <div className="sp-s8-plat-grid">
                    {(['linkedin', 'facebook', 'instagram', 'whatsapp'] as const).map(pl => {
                      const label = platformLabel(pl);
                      const isSelected = p.selectedPlatforms.includes(pl);
                      const connected = isPlatformConnected(pl);
                      const brand = p.platformColors[pl] || '#7c3aed';
                      const acc = p.accounts.find(a => a.platform === pl && a.connected);
                      const blurb = connected
                        ? (pl === 'whatsapp'
                          ? (p.whapiSelectedGroupId ? 'Destination selected — ready to publish.' : 'Account ready to publish. Pick a destination below.')
                          : `${acc?.name || 'Account'} ready to publish.`)
                        : pl === 'instagram'
                          ? 'Connect a Business or Creator account linked to your Facebook Page.'
                          : `No ${label} account connected yet.`;
                      return (
                        <div
                          key={pl}
                          className={'sp-s8-plat' + (isSelected ? ' selected' : '')}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                          aria-label={`${label} ${isSelected ? 'selected for publishing' : 'not selected'}`}
                          onClick={() => p.togglePlatform(pl)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.togglePlatform(pl); } }}
                        >
                          <div className="top">
                            <div className="sp-s8-logo-p" style={{ background: brand }}>
                              <p.PlatformIcon platform={pl} size={21} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <b>{label}</b>
                              <span className={'sp-s8-status' + (connected ? ' on' : '')}>{connected ? 'Connected' : 'Not connected'}</span>
                            </div>
                            <span className="sp-s8-pick" aria-hidden="true"><i>{isSelected ? '✓' : ''}</i>{isSelected ? 'Selected' : 'Select'}</span>
                          </div>
                          <p>{blurb}</p>
                          <div className="row">
                            {connected ? (
                              <>
                                {pl !== 'whatsapp' && (
                                  <button className="sp-s8-btn ghost" onClick={e => { e.stopPropagation(); p.disconnectPlatform(pl); }}>Disconnect</button>
                                )}
                                <button className="sp-s8-btn ghost" onClick={e => { e.stopPropagation(); setCurrentStep(7); }}>Manage</button>
                              </>
                            ) : (
                              <button className="sp-s8-btn primary" onClick={e => { e.stopPropagation(); pl === 'whatsapp' ? p.startWhatsAppConnect() : p.connectPlatform(pl); }}>
                                Connect {label}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {p.selectedPlatforms.includes('whatsapp') && p.whapiConnected && (
                    <div className="sp-s8-whatsapp">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: p.whapiDestinations.length > 0 ? 12 : 0 }}>
                        <div className="sp-s8-logo-p" style={{ background: '#25D366', width: 38, height: 38, borderRadius: 11, fontSize: 15 }}>
                          <p.PlatformIcon platform="whatsapp" size={15} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <b style={{ display: 'block', fontSize: 15, color: '#111827' }}>WhatsApp destination</b>
                          <span className="sp-s8-status on" style={{ marginTop: 4 }}>
                            {p.whapiLoading ? 'Checking…' : p.whapiSelectedDestinations.size > 0 ? `${p.whapiSelectedDestinations.size} selected` : 'Pick a chat, group or community'}
                          </span>
                        </div>
                      </div>
                      <WhatsAppDestinationPicker
                        destinations={p.whapiDestinations}
                        loading={p.whapiGroupsLoading}
                        error={p.whapiGroupsError}
                        selected={p.whapiSelectedDestinations}
                        onChange={p.setWhapiSelectedDestinations}
                        onRefresh={p.loadWhapiDestinations}
                      />
                      {postPublishMedia.length > 1 && (
                        <div style={{ marginTop: 10, fontSize: 12, color: '#92400e', background: '#fffbea', border: '1px solid #f4e3a1', borderRadius: 10, padding: '9px 12px', lineHeight: 1.55 }}>
                          ⚠️ WhatsApp sends <strong>1 image per message</strong> — {postPublishMedia.length - 1} extra image{postPublishMedia.length - 1 === 1 ? '' : 's'} will not be sent to WhatsApp.
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* 2 — WHEN */}
                <section className="sp-s8-card-base">
                  <div className="sp-s8-sec">
                    <div className="sp-s8-num">2</div>
                    <div>
                      <h3>Choose when to publish</h3>
                      <p className="sub">Share right away or pick a date and time.</p>
                    </div>
                  </div>
                  <div className="sp-s8-opts" role="radiogroup" aria-label="Publish timing">
                    {([
                      ['now', '🚀', 'Publish Now', 'Share immediately across selected platforms'],
                      ['later', '📅', 'Schedule for Later', 'Pick a date and time to publish'],
                    ] as const).map(([k, icon, t, sub]) => (
                      <button
                        key={k}
                        className={'sp-s8-opt' + (publishMode === k ? ' selected' : '')}
                        role="radio"
                        aria-checked={publishMode === k}
                        onClick={() => setPublishMode(k)}
                      >
                        <span className="oi" aria-hidden="true">{icon}</span>
                        <div><b>{t}</b><span>{sub}</span></div>
                        <i className="radio" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  <div className={'sp-s8-when' + (publishMode === 'later' ? ' show' : '')}>
                    <div>
                      <label htmlFor="sp-s8-date">Date</label>
                      <input type="date" id="sp-s8-date" value={p.scheduleDate} min={minScheduleDateStr} onChange={e => p.setScheduleDate(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="sp-s8-time">Time</label>
                      <input type="time" id="sp-s8-time" value={p.scheduleTime} onChange={e => p.setScheduleTime(e.target.value)} />
                    </div>
                    <div className="sp-s8-when-tz">🕒 Time zone: <strong style={{ color: '#111827' }}>{userTimeZone}</strong></div>
                    {publishMode === 'later' && (!p.scheduleDate || !p.scheduleTime || !scheduleIsValid) && (
                      <div className="sp-s8-err" role="alert">Please choose a future date and time.</div>
                    )}
                  </div>
                </section>

                <div className="sp-s8-back-row">
                  <button className="sp-s8-btn ghost" onClick={goBack}>← Back</button>
                </div>
              </div>

              {/* ================= ASIDE — SUMMARY ================= */}
              <aside className="sp-s8-aside">
                <div
                  className="sp-s8-card"
                  ref={summaryCardRef}
                  onMouseMove={e => {
                    const el = summaryCardRef.current;
                    if (!el) return;
                    const calm = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                    const fine = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;
                    if (calm || !fine) return;
                    const r = el.getBoundingClientRect();
                    const x = (e.clientX - r.left) / r.width - 0.5;
                    const y = (e.clientY - r.top) / r.height - 0.5;
                    el.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 6}deg)`;
                  }}
                  onMouseLeave={() => { const el = summaryCardRef.current; if (el) el.style.transform = ''; }}
                >
                  <div className="sp-s8-hero">
                    <div className="sp-s8-blob sp-s8-b1" /><div className="sp-s8-blob sp-s8-b2" /><div className="sp-s8-blob sp-s8-b3" />
                    <span className="sp-s8-spark sp-s8-sp1">✦</span><span className="sp-s8-spark sp-s8-sp2">✧</span><span className="sp-s8-spark sp-s8-sp3">✦</span><span className="sp-s8-spark sp-s8-sp4">✧</span>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span className="sp-s8-badge"><span className="sp-s8-live" />Post Summary</span>
                      <button className="sp-s8-edit" onClick={() => setCurrentStep(3)} aria-label="Edit content">✏️ Edit</button>
                    </div>
                    <div className="sp-s8-thumbwrap">
                      {(() => {
                        const thumb = (p.isCarousel ? p.carouselSlides : p.mediaItems)[0] || null;
                        const thumbUrl = thumb?.url || p.generatedImage || p.generatedVideo || postExtraImages[0]?.url || '';
                        const thumbIsVideo = thumb ? thumb.type === 'video' : !!p.generatedVideo && !thumb;
                        return (
                          <div className="sp-s8-thumb">
                            {thumbUrl ? (
                              thumbIsVideo
                                ? <video src={thumbUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            ) : (
                              <span style={{ fontSize: 26, opacity: .85 }}>🖼️</span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="sp-s8-ring" title="Content readiness" role="img" aria-label={`Content readiness ${ringPct} percent`}>
                        <svg viewBox="0 0 36 36" aria-hidden="true">
                          <circle cx="18" cy="18" r="15.5" />
                          <circle className="arc" cx="18" cy="18" r="15.5" style={{ strokeDashoffset: 97.4 * (1 - ringPct / 100) }} />
                        </svg>
                        <b>{ringPct}%</b>
                      </div>
                    </div>
                  </div>

                  <div className="sp-s8-body">
                    <span className={'sp-s8-cap' + (!capTyping ? ' sp-done' : '')}>
                      {!summaryCaption ? <span style={{ color: '#94a3b8' }}>No caption yet.</span> : summaryCaption.slice(0, capReveal)}
                    </span>


                    {p.isCarousel && (
                      <div style={{ fontSize: 13, fontWeight: 700, padding: '8px 11px', borderRadius: 10, background: p.carouselValidation.valid ? '#e3f8ef' : '#fef2f2', color: p.carouselValidation.valid ? '#0b7a53' : '#b91c1c', border: `1px solid ${p.carouselValidation.valid ? '#a7ecd0' : '#fecaca'}` }}>
                        {p.carouselValidation.valid ? `✓ Multiple Images: ${p.carouselSlides.length} slides ready` : `⚠ ${p.carouselValidation.reason}`}
                      </div>
                    )}

                    {p.instagramReelReady && (
                      <div style={{ marginTop: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 12, border: `1.5px solid ${p.trialReel ? '#7c3aed' : '#e8eaf2'}`, background: p.trialReel ? '#faf7ff' : '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <input type="checkbox" checked={p.trialReel} onChange={e => p.setTrialReel(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#7c3aed', cursor: 'pointer' }} />
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111827' }}>Post as Trial Reel</span>
                        </label>
                      </div>
                    )}

                    {p.selectedPlatforms.includes('instagram') && (
                      <div className="sp-s8-collab" style={{ marginTop: 16 }}>
                        <label htmlFor="sp-collab">Instagram Collaborator (Optional)</label>
                        <input
                          id="sp-collab"
                          value={p.collaborator}
                          onChange={e => p.setCollaborator(e.target.value.replace(/^@+/, '').slice(0, 40))}
                          placeholder="Username without @"
                          autoComplete="off"
                          aria-describedby="sp-collab-help"
                        />
                        <small id="sp-collab-help">Instagram will send the collaborator invitation. The collaborator must accept it before the collaboration appears on the post.</small>
                      </div>
                    )}

                    {/* readiness — real checks + per-platform connection */}
                    <div className="sp-s8-ready-list">
                      <h4>Content Readiness</h4>
                      {(() => {
                        const mediaOk = hasMedia || postExtraImages.length > 0;
                        const rows: Array<{ state: 'ok' | 'warn' | 'opt'; label: string; act: string; run?: () => void }> = [
                          hasContent
                            ? { state: 'ok', label: 'Content ready', act: 'Edit', run: () => setCurrentStep(3) }
                            : { state: 'warn', label: 'Content missing', act: 'Generate', run: () => setCurrentStep(3) },
                          mediaOk
                            ? { state: 'ok', label: 'Media ready', act: 'Edit', run: () => setCurrentStep(4) }
                            : { state: 'warn', label: 'Media missing', act: 'Add', run: () => setCurrentStep(4) },
                          p.logoImage
                            ? { state: 'ok', label: 'Branding applied', act: 'Brand', run: () => setCurrentStep(7) }
                            : { state: 'opt', label: 'No logo (optional)', act: 'Brand', run: () => setCurrentStep(7) },
                        ];
                        return (
                          <>
                            {rows.map(r => (
                              <div key={r.label} className={'sp-s8-ri' + (r.state === 'warn' ? ' warn' : r.state === 'opt' ? ' opt-i' : '')}>
                                <i>{r.state === 'ok' ? '✓' : r.state === 'warn' ? '!' : ''}</i>
                                {r.label}
                                {r.run && <button className="ri-act" onClick={r.run}>{r.act}</button>}
                              </div>
                            ))}
                            {p.selectedPlatforms.map(pl => {
                              const on = isPlatformConnected(pl);
                              return (
                                <div key={`c-${pl}`} className={'sp-s8-ri' + (on ? '' : ' warn')}>
                                  <i>{on ? '✓' : '!'}</i>
                                  {platformLabel(pl)} {on ? 'connected' : 'not connected'}
                                  {!on && (
                                    <button className="ri-act" onClick={() => (pl === 'whatsapp' ? p.startWhatsAppConnect() : p.connectPlatform(pl))}>Connect</button>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>

                    {/* per-platform results */}
                    {Object.keys(p.publishStatuses).length > 0 && (
                      <div className="sp-s8-res" aria-live="polite">
                        {Object.entries(p.publishStatuses).map(([pl, st]) => (
                          <div key={pl} className={'sp-s8-res-row' + (st.state === 'failed' ? ' sp-s8-ri warn' : '')}>
                            <i style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontStyle: 'normal', fontSize: 12, flexShrink: 0, border: `1.5px solid ${st.state === 'success' ? '#34d399' : st.state === 'failed' ? '#f59e0b' : '#cbd2e0'}`, color: st.state === 'success' ? '#0f9d6b' : st.state === 'failed' ? '#d97706' : 'transparent' }}>
                              {st.state === 'success' ? '✓' : st.state === 'failed' ? '!' : '…'}
                            </i>
                            <span style={{ fontWeight: 700 }}>{platformLabel(pl)}</span>
                            <span style={{ color: st.state === 'success' ? '#0f9d6b' : st.state === 'failed' ? '#d97706' : '#5b6475' }}>
                              {st.state === 'success' ? 'Published' : st.state === 'pending' ? 'Publishing…' : 'Failed'}
                            </span>
                            {st.state === 'failed' && st.message && <span style={{ fontSize: 12, color: '#5b6475', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {st.message}</span>}
                          </div>
                        ))}
                        {Object.values(p.publishStatuses).some(v => v.state === 'failed') && (
                          <button className="sp-s8-btn ghost" style={{ marginTop: 4, padding: '10px 16px', fontSize: 14 }} onClick={p.retryFailedPublish} disabled={p.isPublishing}>↻ Retry Failed</button>
                        )}
                      </div>
                    )}

                    {/* hint + actions */}
                    <div className="sp-s8-go">
                      <div aria-live="polite" className={'sp-s8-hint' + (canPublish ? ' ok' : '')}>
                        {canPublish ? 'Everything looks good — you’re ready to publish!' : publishBlocker}
                      </div>
                      {publishMode === 'now' ? (
                        <button
                          className={'sp-s8-btn primary' + (canPublish && !p.isPublishing && p.publishCooldown === 0 ? ' sp-s8-cta-on' : '')}
                          onClick={() => p.publishToAll()}
                          disabled={p.isPublishing || p.publishCooldown > 0 || !canPublish}
                          aria-busy={p.isPublishing}
                          title={!canPublish ? publishBlocker : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s before publishing again` : 'Publish now'}
                        >
                          {p.isPublishing ? 'Publishing…' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : '🚀 Publish Now →'}
                        </button>
                      ) : (
                        <button
                          className="sp-s8-btn primary"
                          onClick={() => { void p.schedulePost(); }}
                          disabled={p.isScheduling || !canPublish}
                          aria-busy={p.isScheduling}
                          title={!canPublish ? publishBlocker : 'Schedule post'}
                        >
                          {p.isScheduling ? 'Scheduling…' : '📅 Schedule Post →'}
                        </button>
                      )}
                      <button className="sp-s8-btn ghost" onClick={saveDraft}>💾 Save as Draft</button>
                    </div>
                  </div>
                </div>
              </aside>
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
