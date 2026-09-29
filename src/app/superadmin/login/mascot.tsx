'use client';

// Original SocialPulse mascot. Every part is a separate <g> so the parent can
// drive them independently from a single state string (see login.css) — no
// sprite sheet, no flattened image, no external asset.
//
// Anatomy, top to bottom: ears, head, mask, brows, eyes (+pupils), nose,
// mouth, body, then the two paws last so they can sit in front of the face
// when they rise to cover the eyes.

export type MascotState =
  | 'neutral'
  | 'emailFocus'
  | 'passwordHidden'
  | 'passwordVisible'
  | 'success'
  | 'error';

export default function Mascot({ state }: { state: MascotState }) {
  return (
    <div className="sa-mascot" data-state={state}>
      <svg viewBox="0 0 200 200" width="182" height="182" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="sa-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a5670" />
            <stop offset="100%" stopColor="#2b3346" />
          </linearGradient>
          <linearGradient id="sa-paw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#55617d" />
            <stop offset="100%" stopColor="#333d52" />
          </linearGradient>
          <linearGradient id="sa-mask" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5a657f" />
            <stop offset="100%" stopColor="#262f40" />
          </linearGradient>
        </defs>

        {/* ---------- body (behind the head) ---------- */}
        {/* Kept low and small on purpose: when the paws rise to the eyes the
             body is exposed, and a large one reads as an odd dark blob. */}
        <g className="sa-m-body">
          <ellipse cx="100" cy="162" rx="50" ry="32" fill="url(#sa-body)" />
        </g>

        {/* ---------- ears ---------- */}
        <g className="sa-m-ear sa-m-ear--left">
          <path d="M52 56 C36 34 40 8 58 6 C72 5 76 26 70 50 Z" fill="#4a5670" />
          <path d="M55 46 C45 32 48 16 58 15 C66 14 68 29 64 44 Z" fill="#aab8d0" />
        </g>
        <g className="sa-m-ear sa-m-ear--right">
          <path d="M148 56 C164 34 160 8 142 6 C128 5 124 26 130 50 Z" fill="#4a5670" />
          <path d="M145 46 C155 32 152 16 142 15 C134 14 132 29 136 44 Z" fill="#aab8d0" />
        </g>

        {/* ---------- head ---------- */}
        <g className="sa-m-head">
          <ellipse cx="100" cy="92" rx="62" ry="56" fill="#eef3f9" />
          <path
            d="M38 92 C38 58 64 38 100 38 C136 38 162 58 162 92 L162 92 C162 78 140 72 100 72 C60 72 38 78 38 92 Z"
            fill="url(#sa-mask)"
          />
          {/* cheeks */}
          <ellipse className="sa-m-cheek sa-m-cheek--left" cx="52" cy="106" rx="13" ry="7" />
          <ellipse className="sa-m-cheek sa-m-cheek--right" cx="148" cy="106" rx="13" ry="7" />
        </g>

        {/* ---------- brows ---------- */}
        <g className="sa-m-brow sa-m-brow--left">
          <rect x="66" y="72" width="22" height="4" rx="2" fill="#2a3240" />
        </g>
        <g className="sa-m-brow sa-m-brow--right">
          <rect x="112" y="72" width="22" height="4" rx="2" fill="#2a3240" />
        </g>

        {/* ---------- eyes ---------- */}
        <g className="sa-m-eye sa-m-eye--left">
          <ellipse cx="78" cy="90" rx="12" ry="10" fill="#fbfdff" />
          <g className="sa-m-pupil">
            <circle cx="78" cy="91" r="6" fill="#151b26" />
            <circle cx="80" cy="88" r="2" fill="#fff" opacity="0.9" />
          </g>
        </g>
        <g className="sa-m-eye sa-m-eye--right">
          <ellipse cx="122" cy="90" rx="12" ry="10" fill="#fbfdff" />
          <g className="sa-m-pupil">
            <circle cx="122" cy="91" r="6" fill="#151b26" />
            <circle cx="124" cy="88" r="2" fill="#fff" opacity="0.9" />
          </g>
        </g>

        {/* ---------- nose + mouth ---------- */}
        <g className="sa-m-nose">
          <ellipse cx="100" cy="110" rx="12" ry="9" fill="#1a202b" />
        </g>
        <g className="sa-m-mouth">
          <path className="sa-m-mouth--rest" d="M88 124 Q100 132 112 124" fill="none" stroke="#2a3240" strokeWidth="3.5" strokeLinecap="round" />
          <path className="sa-m-mouth--happy" d="M84 120 Q100 138 116 120 Z" fill="#2a3240" />
        </g>

        {/* ---------- paws (in front of the face) ---------- */}
        <g className="sa-m-paw sa-m-paw--left">
          <circle cx="64" cy="150" r="28" fill="url(#sa-paw)" />
          <ellipse cx="64" cy="160" rx="14" ry="9" fill="#b9c4d6" opacity="0.85" />
          <circle cx="64" cy="148" r="6" fill="#b9c4d6" opacity="0.85" />
        </g>
        <g className="sa-m-paw sa-m-paw--right">
          <circle cx="136" cy="150" r="28" fill="url(#sa-paw)" />
          <ellipse cx="136" cy="160" rx="14" ry="9" fill="#b9c4d6" opacity="0.85" />
          <circle cx="136" cy="148" r="6" fill="#b9c4d6" opacity="0.85" />
        </g>
      </svg>
    </div>
  );
}
