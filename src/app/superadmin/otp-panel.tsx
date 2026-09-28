'use client';

import { useState } from 'react';
import OtpInput from '@/app/login-signup/otp-input';

// Shared OTP step for the separate Superadmin auth UI (/superadmin/login,
// /superadmin/signup). Talks only to the existing shared OTP endpoints —
// no second OTP implementation. Styling matches the Superadmin theme.
export default function SuperadminOtpPanel({
  challengeId,
  onVerified,
  onBack,
}: {
  challengeId: string;
  onVerified: (data: { redirect?: string; canResetPassword?: boolean }) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function verify() {
    if (code.trim().length !== 6 || busy) return;
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
      onVerified(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy) return;
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
      if (!res.ok) setError(data.error || 'Could not resend the code.');
      else setInfo('A new code was sent.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: '#aeb0d4', lineHeight: 1.6 }}>Enter the 6-digit verification code we just sent.</div>
      {error && <div role="alert" style={{ fontSize: 13, color: '#fca5a5', backgroundColor: 'rgba(220,38,38,0.12)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 10, padding: '10px 12px' }}>{error}</div>}
      {info && <div style={{ fontSize: 13, color: '#6ee7b7', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 10, padding: '10px 12px' }}>{info}</div>}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <OtpInput value={code} onChange={setCode} disabled={busy} />
      </div>
      <button
        type="button"
        onClick={verify}
        disabled={busy || code.trim().length !== 6}
        style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: busy || code.trim().length !== 6 ? '#3b3f7a' : 'linear-gradient(135deg,#6b5cf6,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy || code.trim().length !== 6 ? 'default' : 'pointer', fontFamily: 'inherit', width: '100%' }}
      >
        {busy ? 'Verifying…' : 'Verify Code'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" onClick={onBack} style={{ border: 'none', background: 'none', color: '#8b8eb8', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>← Back</button>
        <button type="button" onClick={resend} disabled={busy} style={{ border: 'none', background: 'none', color: '#a99fff', fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>Resend code</button>
      </div>
    </div>
  );
}
