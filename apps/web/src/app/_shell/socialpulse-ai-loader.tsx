'use client';

// SocialPulseAILoader — premium orbital AI-generation loader.
//
// Brand geometry recreated as SVG (never the flattened PNG, so parts animate
// independently): stationary navy rounded-square frame, fixed pulsing center
// dot, and the two logo arc segments revolving together around the dot.
// GPU-friendly: only transform + opacity are animated. Honors
// prefers-reduced-motion by freezing to the static mark.

export interface SocialPulseAILoaderProps {
  /** Overrides the primary line; otherwise mode copy is used. */
  message?: string;
  mode?: 'image' | 'carousel';
  /** Small inline variant (~56px). Otherwise responsive 96–160px. */
  compact?: boolean;
}

const COPY = {
  image: {
    primary: 'Generating your image...',
    secondary: 'SocialPulse AI is creating your visual',
    aria: 'Generating AI image',
  },
  carousel: {
    primary: 'Generating your carousel...',
    secondary: 'Creating and preparing your slides',
    aria: 'Generating AI carousel',
  },
} as const;

export default function SocialPulseAILoader({ message, mode = 'image', compact = false }: SocialPulseAILoaderProps) {
  const copy = COPY[mode];
  // Arc geometry mirrors the logo: r=52 circle, left segment ~200° starting
  // at 125° (lower-left, sweeping through west and north), right segment
  // ~120° starting at 335° (through east to south-south-east). Round caps.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={copy.aria}
      className={compact ? 'sp-ai-loader sp-ai-compact' : 'sp-ai-loader'}
    >
      <style>{`
        .sp-ai-loader { display: flex; flex-direction: column; align-items: center; gap: 18px; }
        .sp-ai-stage { position: relative; width: clamp(96px, 24vw, 160px); aspect-ratio: 1; display: flex; align-items: center; justify-content: center; padding: 26px; }
        .sp-ai-compact .sp-ai-stage { width: 56px; padding: 12px; }
        .sp-ai-halo { position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(circle, rgba(124,93,250,0.28) 0%, rgba(124,93,250,0.08) 45%, transparent 68%); }
        .sp-ai-frame { position: relative; width: 100%; aspect-ratio: 1; border-radius: 30%;
          background: radial-gradient(circle at 50% 42%, #171732 0%, #0c0c1e 72%);
          border: 2px solid rgba(167,139,250,0.65);
          box-shadow: 0 0 18px rgba(124,93,250,0.35), 0 0 46px rgba(99,102,241,0.18), inset 0 0 22px rgba(20,20,50,0.9);
          animation: spAiBreathe 3.6s ease-in-out infinite; }
        @keyframes spAiBreathe {
          0%, 100% { box-shadow: 0 0 18px rgba(124,93,250,0.35), 0 0 46px rgba(99,102,241,0.18), inset 0 0 22px rgba(20,20,50,0.9); }
          50% { box-shadow: 0 0 26px rgba(139,110,250,0.55), 0 0 64px rgba(99,102,241,0.30), inset 0 0 22px rgba(20,20,50,0.9); }
        }
        .sp-ai-mark { position: absolute; inset: 12%; width: 76%; height: 76%; overflow: visible; }
        .sp-ai-orbit { transform-origin: 100px 100px; animation: spAiOrbit 2.6s linear infinite; }
        @keyframes spAiOrbit { to { transform: rotate(360deg); } }
        .sp-ai-flicker { animation: spAiFlicker 3.1s ease-in-out infinite; }
        @keyframes spAiFlicker { 0%, 100% { opacity: 1; } 50% { opacity: 0.92; } }
        .sp-ai-arcs { filter: drop-shadow(0 0 6px rgba(139,110,250,0.6)) drop-shadow(0 0 16px rgba(99,102,241,0.35)); }
        .sp-ai-dot { transform-origin: 100px 100px; animation: spAiPulse 2.2s ease-in-out infinite;
          filter: drop-shadow(0 0 5px rgba(255,255,255,0.75)) drop-shadow(0 0 14px rgba(167,139,250,0.5)); }
        @keyframes spAiPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
        .sp-ai-primary { margin: 0; font-size: 17px; font-weight: 800; color: #f1f0ff; letter-spacing: -0.01em; text-align: center; }
        .sp-ai-compact .sp-ai-primary { font-size: 13px; }
        .sp-ai-secondary { margin: 4px 0 0; font-size: 13px; color: #8f8fb0; text-align: center; }
        .sp-ai-compact .sp-ai-secondary { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .sp-ai-orbit, .sp-ai-dot { animation: none; }
          .sp-ai-flicker { animation: spAiFlickerSoft 4s ease-in-out infinite; }
          @keyframes spAiFlickerSoft { 0%, 100% { opacity: 1; } 50% { opacity: 0.96; } }
          .sp-ai-frame { animation: none; }
        }
      `}</style>
      <div className="sp-ai-stage">
        <div className="sp-ai-halo" aria-hidden="true" />
        <div className="sp-ai-frame" aria-hidden="true" />
        <svg className="sp-ai-mark" viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id="spAiArcBlue" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#5b8cff" />
              <stop offset="1" stopColor="#7c5cff" />
            </linearGradient>
            <linearGradient id="spAiArcViolet" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          <g className="sp-ai-orbit">
            <g className="sp-ai-flicker sp-ai-arcs" fill="none" strokeLinecap="round" strokeWidth="22">
              <circle cx="100" cy="100" r="52" stroke="url(#spAiArcBlue)" strokeDasharray="181.5 145.3" transform="rotate(125 100 100)" />
              <circle cx="100" cy="100" r="52" stroke="url(#spAiArcViolet)" strokeDasharray="108.9 217.9" transform="rotate(335 100 100)" />
            </g>
          </g>
          <circle className="sp-ai-dot" cx="100" cy="100" r="13" fill="#ffffff" />
        </svg>
      </div>
      <div>
        <p className="sp-ai-primary">{message || copy.primary}</p>
        <p className="sp-ai-secondary">{copy.secondary}</p>
      </div>
    </div>
  );
}
