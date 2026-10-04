'use client';

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

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const setDigitAt = (index: number, char: string) => {
    const next = digits.slice();
    next[index] = char;
    onChange(next.join(''));
  };

  const handleChange = (index: number, raw: string) => {
    const digitsOnly = raw.replace(/\D/g, '');
    if (!digitsOnly) {
      setDigitAt(index, '');
      return;
    }
    if (digitsOnly.length > 1) {
      // Fast typing or an autofill can deliver multiple characters to one
      // box — treat it the same as a paste.
      const next = value.split('');
      for (let i = 0; i < digitsOnly.length && index + i < length; i++) next[index + i] = digitsOnly[i];
      onChange(next.join('').slice(0, length));
      const lastFilled = Math.min(index + digitsOnly.length, length) - 1;
      refs.current[Math.min(lastFilled + 1, length - 1)]?.focus();
      return;
    }
    setDigitAt(index, digitsOnly);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
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
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          disabled={disabled}
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
