'use client';

// CANONICAL COPY — apps/superadmin/src/app/login-signup/otp-input.tsx must stay
// byte-identical to this file (enforced by
// `npm run test:shared-otp-input` in apps/web).
//
// This is a real duplicate, not an oversight. `packages/ui` is an unwired
// scaffold, and packages/ lies outside both apps' Docker build contexts
// (`context: ./apps/web`, `context: ./apps/superadmin`), so importing from
// there means `npm install` no-ops the dependency and `next build` fails with
// `Module not found`. That was tried and reverted for packages/api-client —
// see its README and apps/superadmin/src/lib/admin-client.ts.
//
// Until the Dockerfiles build from the repo root, these two copies are forced
// by the deploy topology. The thing that can actually break is drift: the
// box-state fix for a stuck-OTP bug once landed here only, leaving the
// Superadmin email-change flow on the broken component. Hence the guard above.
//
// The two apps share ONE /api/auth/otp/* contract and ONE OTP UI; do not
// redesign this per-app.

import { useRef, useState, useEffect } from 'react';

const boxStyle: React.CSSProperties = {
  width: 44,
  height: 52,
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  fontSize: 22,
  fontWeight: 700,
  textAlign: 'center',
  color: '#0f172a',
  backgroundColor: '#fff',
  outline: 'none',
  fontFamily: 'inherit',
};

// Six single-digit boxes behaving like one field: typing advances focus,
// Backspace on an empty box steps back, and pasting a 6-digit code (or
// typing fast enough that the browser coalesces it) fills every box at once.
//
// Positions are held in local per-box state, NOT derived by indexing a single
// flat string. A flat string cannot represent a gap: `['1','','','2'].join('')`
// is `'12'`, so a digit typed into box 4 collapses to box 1 and the code never
// reaches 6 characters. The parent only ever receives the gap-free digits,
// which is enough because 6 emitted digits implies all 6 boxes are occupied.
export default function OtpInput({
  length = 6,
  value,
  onChange,
  disabled,
  autoFocus = true,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const blank = () => Array.from({ length }, () => '');
  const [boxes, setBoxes] = useState<string[]>(blank);
  const [lastValue, setLastValue] = useState(value);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // The parent clears `value` on resend and on a failed attempt. Mirror that
  // reset during render (rather than in an effect, which would cascade a
  // second render pass) so stale digits cannot survive into a new code.
  if (value !== lastValue) {
    setLastValue(value);
    if (value === '') setBoxes(blank());
  }

  const emit = (next: string[]) => {
    setBoxes(next);
    onChange(next.filter(Boolean).join(''));
  };

  const setDigitAt = (index: number, char: string) => {
    const next = boxes.slice();
    next[index] = char;
    emit(next);
  };

  const handleChange = (index: number, raw: string) => {
    const digitsOnly = raw.replace(/\D/g, '');
    if (!digitsOnly) {
      setDigitAt(index, '');
      return;
    }
    if (digitsOnly.length > 1) {
      // Fast typing, a paste, or an SMS one-time-code autofill can all deliver
      // multiple characters to one box.
      const next = boxes.slice();
      // A payload that is itself a complete code is a fresh full entry, not an
      // overflow into the middle of a half-typed one. Autofill targets
      // whichever box has focus, so without this an autofill landing on box 4
      // would drop three digits and never reach 6.
      const from = digitsOnly.length >= length ? 0 : index;
      for (let i = 0; i < digitsOnly.length && from + i < length; i++) next[from + i] = digitsOnly[i];
      emit(next);
      const lastFilled = Math.min(from + digitsOnly.length, length) - 1;
      refs.current[Math.min(lastFilled + 1, length - 1)]?.focus();
      return;
    }
    setDigitAt(index, digitsOnly);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Correcting a digit: maxLength={1} makes the browser DISCARD a keystroke
    // aimed at a box that already holds a digit, so a mistyped digit could
    // never be fixed without backspacing first. Intercept the key and write
    // the box directly.
    if (/^\d$/.test(e.key) && boxes[index]) {
      e.preventDefault();
      setDigitAt(index, e.key);
      if (index < length - 1) refs.current[index + 1]?.focus();
      return;
    }
    if (e.key === 'Backspace' && !boxes[index] && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    const start = pasted.length >= length ? 0 : Math.max(0, boxes.findIndex(b => !b));
    const next = boxes.slice();
    for (let i = 0; i < pasted.length && start + i < length; i++) next[start + i] = pasted[i];
    emit(next);
    refs.current[Math.min(start + pasted.length, length - 1)]?.focus();
  };

  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      {boxes.map((digit, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          // Required for the browser's SMS one-time-code autofill (iOS Safari
          // and Chrome both gate on this exact token). Only the first box
          // carries it — browsers ignore it on every subsequent field.
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={() => setFocusIndex(i)}
          style={{
            ...boxStyle,
            borderColor: focusIndex === i ? '#7c6cff' : '#e2e8f0',
            boxShadow: focusIndex === i ? '0 0 0 3px rgba(124,108,255,0.15)' : 'none',
            opacity: disabled ? 0.6 : 1,
          }}
          aria-label={`Digit ${i + 1} of ${length}`}
        />
      ))}
    </div>
  );
}
