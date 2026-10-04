'use client';

import { useEffect, useState } from 'react';
import OtpInput from '@/app/login-signup/otp-input';

// OTP step for the separate Superadmin login UI. Talks only to the existing
// shared OTP endpoints — no second OTP implementation. Styled to match the
// rest of the login card (mascot, glass panel and door button live in the
// parent screen).
export default function SuperadminOtpPanel({
  challengeId,
  resendAvailableAt,
  expiresAt,
  onResent,
  onVerified,
  onBack,
  frozen = false,
  phase = 'idle',
}: {
  challengeId: string;
  resendAvailableAt?: string;
  expiresAt?: string;
  onResent: (expiresAt: string) => void;
  // May be async: the parent plays the success animation before navigating,
  // so this must be awaited or the redirect would cut it short.
  onVerified: (data: { redirect?: string; canResetPassword?: boolean }) => void | Promise<void>;
  onBack: () => void;
  // While the parent runs the post-verification animation the challenge is
  // already consumed, so every control here must be inert — not merely the
  // verify button.
  frozen?: boolean;
  phase?: 'idle' | 'doorOpen' | 'walking' | 'happy';
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  // Server enforces a 60s resend cooldown and a longer hourly cap; counting
  // both down here means the button is honestly disabled instead of failing
  // with a 429 on every click.
  const [cooldownSecs, setCooldownSecs] = useState(0);
  // Once a code is expired (or out of resends) it can never be revived —
  // resending would only ever 400. Track that so the UI offers the one action
  // that does work: a brand-new request.
  const [dead, setDead] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!resendAvailableAt) return;
    const tick = () => {
      const remaining = new Date(resendAvailableAt).getTime() - Date.now();
      setCooldownSecs(remaining > 0 ? Math.ceil(remaining / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAvailableAt]);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setExpired(new Date(expiresAt).getTime() <= Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const blocked = dead || expired;
  const inert = busy || blocked || frozen;
  const doorClass = phase === 'doorOpen' || phase === 'walking' ? 'dooropen' : '';
  const walkingClass = phase === 'walking' ? 'walking' : '';

  function waitLabel(secs: number): string {
    if (secs >= 3600) return `${Math.ceil(secs / 3600)}h`;
    if (secs >= 120) return `${Math.ceil(secs / 60)}m`;
    return `${secs}s`;
  }

  async function verify() {
    if (code.trim().length !== 6 || inert) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, otp: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed. Please try again.');
        return;
      }
      await onVerified(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (inert || cooldownSecs > 0) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/auth/otp/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // An expired or resend-exhausted code is terminal — a new request is
        // the only way forward, so say that instead of leaving a Resend button
        // that can never work again.
        if (/maximum resend attempts|invalid or has expired/i.test(String(data.error || ''))) {
          setDead(true);
          setError('This code can no longer be used. Request a new code to continue.');
          return;
        }
        setError(data.error || 'Could not resend the code.');
        // Cooldown and rate-limit rejections carry the exact remaining time.
        if (typeof data.retryAfterMs === 'number') setCooldownSecs(Math.ceil(data.retryAfterMs / 1000));
        return;
      }
      setCode('');
      setInfo('A new code was sent.');
      setDead(false);
      setExpired(false);
      const next = typeof data.resendAvailableAt === 'string' ? data.resendAvailableAt : null;
      setCooldownSecs(next ? Math.max(0, Math.ceil((new Date(next).getTime() - Date.now()) / 1000)) : 60);
      onResent(typeof data.expiresAt === 'string' ? data.expiresAt : '');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="sa-error" role="alert">{error}</div>}
      {info && <p className="sa-notice">{info}</p>}
      {blocked && !error && (
        <p className="sa-notice" style={{ color: '#fcd34d' }}>
          {expired ? 'This code has expired. Request a new one to continue.' : 'You have used all the resends for this code. Request a new one to continue.'}
        </p>
      )}

      <div className="sa-otp">
        <OtpInput value={code} onChange={setCode} disabled={inert} />
      </div>

      <button className={`sa-btn ${doorClass} ${walkingClass}`} type="button" onClick={verify} disabled={inert || code.trim().length !== 6}>
        <span className="sa-btn__label">
          {busy ? 'Verifying…' : frozen ? 'Welcome' : blocked ? 'Code expired' : 'Verify & Continue'}
        </span>
        <span className="sa-door">
          <span className="sa-door__frame" />
          <span className="sa-door__panel" />
          <span className="sa-person">
            <span className="sa-person__head" />
            <span className="sa-person__body" />
            <span className="sa-person__legs" />
          </span>
        </span>
      </button>

      <div className="sa-foot sa-foot-alt" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="sa-link muted" onClick={onBack} disabled={inert}>
          {blocked ? '← Request a new code' : '← Back'}
        </button>
        {blocked ? (
          <span className="sa-wait">Cannot resend</span>
        ) : cooldownSecs > 0 ? (
          <span className="sa-wait">Resend available in {waitLabel(cooldownSecs)}</span>
        ) : (
          <button type="button" className="sa-link" onClick={resend} disabled={inert}>Resend code</button>
        )}
      </div>
    </div>
  );
}
