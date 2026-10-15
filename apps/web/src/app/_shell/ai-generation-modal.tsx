'use client';

import { useEffect, useRef, useState } from 'react';
import { SP_LOADER_ARCS, SP_LOADER_BASE, SP_LOADER_DOT } from './brand-assets';

// AI generation modal — overlay flow driven EXCLUSIVELY by real request
// state. No demo controls, no timers, no fake progress: the loader shows
// while the request is pending, selection after real success, retry after
// real failure. There is no Cancel during GENERATING because the generation
// pipeline has no AbortController — the close button is disabled in-flight
// instead of faking cancellation.

export type GenModalMode = 'image' | 'carousel';
export type GenModalPhase = 'generating' | 'selecting' | 'error';

export interface GenModalItem {
  id: string;
  url: string;
}

interface AIGenerationModalProps {
  mode: GenModalMode;
  phase: GenModalPhase;
  /** Real results only: 1 held image, or the made carousel slides. */
  items: GenModalItem[];
  /** Real error message only. */
  error: string;
  onUseSelected: (ids: string[]) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  /** Offered only when nothing is in flight. */
  onClose: () => void;
}

const COPY = {
  image: {
    loadingTitle: 'Generating your images...',
    loadingSub: 'SocialPulse AI is preparing your options',
    ariaLoading: 'Generating AI images',
    selectingTitle: 'Choose your images',
    selectingSub: 'Select one or more generated options to continue.',
    useLabel: 'Use Selected',
  },
  carousel: {
    loadingTitle: 'Generating your carousel...',
    loadingSub: 'Creating and preparing your slides',
    ariaLoading: 'Generating AI carousel',
    selectingTitle: 'Your carousel slides',
    selectingSub: 'Review your generated slides, then apply them.',
    useLabel: 'Use Carousel',
  },
} as const;

function LoaderMark({ label }: { label: string }) {
  return (
    <div className="sp-gen-logo" role="status" aria-label={label}>
      <img className="sp-gen-base" src={SP_LOADER_BASE} alt="" aria-hidden="true" />
      <img className="sp-gen-arcs" src={SP_LOADER_ARCS} alt="" aria-hidden="true" />
      <img className="sp-gen-dot" src={SP_LOADER_DOT} alt="" aria-hidden="true" />
    </div>
  );
}

export default function AIGenerationModal(p: AIGenerationModalProps) {
  const copy = COPY[p.mode];
  const [selected, setSelected] = useState<string[]>(() => p.items.map(i => i.id));
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const inFlight = p.phase === 'generating';

  // New result set → select all of it. Runs on real arrivals only.
  useEffect(() => { setSelected(p.items.map(i => i.id)); }, [p.items]);
  // Focus in on open, restore on close. Escape closes only when safe.
  useEffect(() => {
    prevFocus.current = document.activeElement;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight) p.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prevFocus.current instanceof HTMLElement) prevFocus.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const toggle = (id: string) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const cols = p.items.length <= 1 ? '1fr' : p.items.length === 2 ? 'repeat(2,1fr)' : 'repeat(auto-fill,minmax(150px,1fr))';

  return (
    <div
      onClick={() => { if (!inFlight) p.onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'rgba(8,13,31,0.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
    >
      <style>{`
        .sp-gen-panel { width: min(860px, 94vw); max-height: 92vh; overflow-y: auto; background: linear-gradient(180deg,#ffffff,#fbfbfe); border-radius: 30px; border: 1px solid rgba(255,255,255,.7); box-shadow: 0 36px 100px rgba(8,13,31,.35); outline: none; }
        .sp-gen-head { min-height: 76px; display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid #eceff4; position: sticky; top: 0; background: #fff; z-index: 2; border-radius: 30px 30px 0 0; }
        .sp-gen-title { font-size: 21px; font-weight: 800; letter-spacing: -0.02em; color: #0f172a; }
        .sp-gen-x { width: 40px; height: 40px; border-radius: 13px; border: 1px solid #dfe3eb; background: #fff; color: #667085; font-size: 22px; line-height: 1; }
        .sp-gen-x:not(:disabled) { cursor: pointer; box-shadow: 0 6px 18px rgba(15,23,42,.06); }
        .sp-gen-x:disabled { opacity: 0.45; cursor: not-allowed; }
        .sp-gen-stage { padding: 40px 28px 48px; text-align: center; }
        .sp-gen-logo { width: 150px; height: 150px; margin: 0 auto 28px; position: relative; animation: spGenBreathe 3.6s ease-in-out infinite; }
        .sp-gen-logo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
        .sp-gen-base { z-index: 1; }
        .sp-gen-arcs { z-index: 2; animation: spGenSpin 2.55s linear infinite, spGenFlicker 3.1s ease-in-out infinite; transform-origin: 50% 50%; will-change: transform, filter, opacity; }
        .sp-gen-dot { z-index: 3; animation: spGenDot 2.55s ease-in-out infinite; transform-origin: 50% 50%; }
        @keyframes spGenSpin { to { transform: rotate(360deg); } }
        @keyframes spGenFlicker {
          0%, 100% { opacity: .98; filter: drop-shadow(0 0 5px rgba(94,92,255,.25)); }
          36% { opacity: 1; filter: drop-shadow(0 0 10px rgba(88,122,255,.45)); }
          58% { opacity: .95; }
          74% { opacity: 1; filter: drop-shadow(0 0 13px rgba(165,92,255,.42)); }
        }
        @keyframes spGenDot { 0%, 100% { transform: scale(1); opacity: .96; } 50% { transform: scale(1.06); opacity: 1; } }
        @keyframes spGenBreathe {
          0%, 100% { filter: drop-shadow(0 0 15px rgba(124,92,255,.20)); }
          50% { filter: drop-shadow(0 0 31px rgba(124,92,255,.42)); }
        }
        .sp-gen-h1 { margin: 0; font-size: 34px; line-height: 1.1; letter-spacing: -0.03em; font-weight: 800; color: #0f172a; }
        .sp-gen-sub { margin: 12px 0 0; font-size: 17px; color: #747b8b; }
        .sp-gen-pill { margin-top: 26px; display: inline-flex; align-items: center; gap: 10px; padding: 11px 18px; border-radius: 999px; color: #6d28d9; background: linear-gradient(180deg,#f7f0ff,#f2ebff); border: 1px solid rgba(124,58,237,.08); font-weight: 800; font-size: 14px; }
        .sp-gen-pill i { width: 9px; height: 9px; border-radius: 50%; background: #7c3aed; box-shadow: 0 0 12px rgba(124,58,237,.7); }
        .sp-gen-enter { animation: spGenEnter 320ms ease; }
        @keyframes spGenEnter { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        .sp-gen-grid { display: grid; gap: 14px; margin: 6px auto 0; max-width: 720px; }
        .sp-gen-tile { border-radius: 18px; overflow: hidden; cursor: pointer; border: 3px solid transparent; background: #0f172a; position: relative; transition: transform .18s ease, outline-color .18s ease; padding: 0; }
        .sp-gen-tile:hover { transform: translateY(-3px); }
        .sp-gen-tile.on { outline: 4px solid #8b5cf6; }
        .sp-gen-tile img { width: 100%; height: 100%; object-fit: cover; display: block; aspect-ratio: 1; }
        .sp-gen-tile .tick { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; border-radius: 50%; background: #7c3aed; color: #fff; font-size: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .sp-gen-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
        .sp-gen-btn { padding: 12px 24px; border-radius: 13px; border: none; background: linear-gradient(135deg,#7c3aed,#a855f7); color: #fff; font-weight: 800; font-size: 14px; cursor: pointer; font-family: inherit; }
        .sp-gen-btn:disabled { background: #DDD6FE; cursor: not-allowed; }
        .sp-gen-ghost { padding: 12px 24px; border-radius: 13px; border: 1.5px solid #e2e8f0; background: #fff; color: #334155; font-weight: 800; font-size: 14px; cursor: pointer; font-family: inherit; }
        .sp-gen-err { width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 20px; display: flex; align-items: center; justify-content: center; background: #fff1f2; color: #e11d48; font-size: 34px; font-weight: 900; }
        @media (max-width: 640px) {
          .sp-gen-panel { border-radius: 22px; width: 96vw; }
          .sp-gen-logo { width: 104px; height: 104px; }
          .sp-gen-h1 { font-size: 25px; }
          .sp-gen-sub { font-size: 15px; }
          .sp-gen-stage { padding: 30px 18px 36px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sp-gen-logo, .sp-gen-arcs, .sp-gen-dot { animation: none !important; }
        }
      `}</style>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={p.phase === 'generating' ? copy.ariaLoading : p.phase === 'error' ? 'Generation failed' : 'Choose generated images'}
        className="sp-gen-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="sp-gen-head">
          <div className="sp-gen-title">SocialPulse AI</div>
          <button
            className="sp-gen-x"
            aria-label="Close"
            disabled={inFlight}
            title={inFlight ? 'Generation in progress — closing is disabled until it finishes' : 'Close'}
            onClick={p.onClose}
          >×</button>
        </div>

        <div className="sp-gen-stage">
          {p.phase === 'generating' && (
            <div role="status" aria-live="polite" aria-label={copy.ariaLoading}>
              <LoaderMark label={copy.ariaLoading} />
              <h1 className="sp-gen-h1">{p.mode === 'image' ? 'Generating your images...' : 'Generating your carousel...'}</h1>
              <p className="sp-gen-sub">{p.mode === 'image' ? 'SocialPulse AI is preparing your options' : 'Creating and preparing your slides'}</p>
              <div><span className="sp-gen-pill"><i />AI generation in progress</span></div>
            </div>
          )}

          {p.phase === 'selecting' && (
            <div className="sp-gen-enter">
              <h1 className="sp-gen-h1" style={{ fontSize: 28 }}>{copy.selectingTitle}</h1>
              <p className="sp-gen-sub" style={{ fontSize: 15 }}>{copy.selectingSub}</p>
              <div className="sp-gen-grid" style={{ gridTemplateColumns: cols, maxWidth: p.items.length <= 1 ? 400 : 720, marginTop: 22 }}>
                {p.items.map(item => {
                  const on = selected.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      className={'sp-gen-tile' + (on ? ' on' : '')}
                      onClick={() => toggle(item.id)}
                      aria-pressed={on}
                      title={on ? 'Selected — click to deselect' : 'Click to select'}
                    >
                      <img src={item.url} alt="Generated option" />
                      {on && <span className="tick">✓</span>}
                    </button>
                  );
                })}
              </div>
              <div className="sp-gen-actions">
                <button className="sp-gen-btn" disabled={selected.length === 0} onClick={() => p.onUseSelected(selected)}>
                  {copy.useLabel}{selected.length > 1 ? ` (${selected.length})` : ''}
                </button>
                <button className="sp-gen-ghost" onClick={p.onRegenerate}>Regenerate</button>
                <button className="sp-gen-ghost" onClick={p.onClose}>Cancel</button>
              </div>
            </div>
          )}

          {p.phase === 'error' && (
            <div className="sp-gen-enter" role="alert">
              <div className="sp-gen-err">!</div>
              <h1 className="sp-gen-h1" style={{ fontSize: 28 }}>Generation failed</h1>
              <p className="sp-gen-sub" style={{ fontSize: 15 }}>{p.error || 'Please try again. Your current Content Studio state is unchanged.'}</p>
              <div className="sp-gen-actions">
                <button className="sp-gen-btn" onClick={p.onRetry}>Retry</button>
                <button className="sp-gen-ghost" onClick={p.onClose}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
