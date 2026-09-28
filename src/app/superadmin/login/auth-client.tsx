'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SuperadminOtpPanel from '../otp-panel';
import { loginIdentifierSchema, passwordSchema } from '@/lib/auth/schemas';
import { PASSWORD_REQUIREMENTS } from '@/lib/auth/password-rules';

type Step = 'credentials' | 'forgot-identifier' | 'channel-select' | 'otp-entry' | 'reset-password' | 'reset-done';
type Channel = 'EMAIL' | 'WHATSAPP';

const card: React.CSSProperties = {
  width: '100%', maxWidth: 420, backgroundColor: '#15173a', borderRadius: 18,
  borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2d63',
  boxShadow: '0 24px 64px rgba(0,0,0,0.45)', padding: '30px 28px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 10,
  borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2d63',
  fontSize: 14, color: '#fff', backgroundColor: '#0d0f2b', outline: 'none', fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#aeb0d4', marginBottom: 6, display: 'block' };

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function SuperadminLoginClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [channels, setChannels] = useState<{ email?: string | null; whatsapp?: string | null }>({});
  const [challengeId, setChallengeId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirmRoleAndEnter() {
    const res = await fetch('/api/superadmin/auth/check');
    if (res.ok) router.replace('/superadmin');
    else {
      await fetch('/api/auth/logout', { method: 'POST' });
      setError('This account is not a Superadmin.');
      setStep('credentials');
    }
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!loginIdentifierSchema.safeParse(identifier).success) { setError('Enter a valid email or mobile number.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/superadmin/auth/login', { identifier, password });
      if (!ok) { setError(typeof data.error === 'string' ? data.error : 'Login failed.'); return; }
      setChannels((data.channels as { email?: string; whatsapp?: string | null }) || {});
      setStep('channel-select');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function startForgot(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!forgotIdentifier.trim()) { setError('Enter your email or mobile number.'); return; }
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/auth/password/forgot', { identifier: forgotIdentifier.trim() });
      if (!ok) { setError(typeof data.error === 'string' ? data.error : 'Could not start password reset.'); return; }
      setChannels((data.channels as { email?: string; whatsapp?: string | null }) || {});
      setChallengeId(typeof data.challengeId === 'string' ? data.challengeId : '');
      setStep(data.challengeId ? 'otp-entry' : 'channel-select');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(ch: Channel) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { ok, data } = await postJson('/api/auth/otp/request', { channel: ch });
      if (!ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send the code.'); return; }
      setChallengeId(typeof data.challengeId === 'string' ? data.challengeId : '');
      setStep('otp-entry');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const bad = passwordSchema.safeParse(newPassword);
    if (!bad.success) { setError(bad.error.issues[0]?.message || 'Invalid password.'); return; }
    if (newPassword !== confirmNewPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/auth/password/reset', { newPassword, confirmPassword: confirmNewPassword });
      if (!ok) { setError(typeof data.error === 'string' ? data.error : 'Could not reset the password.'); return; }
      setStep('reset-done');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'radial-gradient(1200px 600px at 50% -10%, #1b1d42 0%, #0d0f2b 60%)' }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 4 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: '#6b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,12 7,12 10,5 14,19 17,12 22,12" /></svg>
          </span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: '0.02em' }}>SOCIALPULSE</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#a99fff', letterSpacing: '0.16em' }}>SUPERADMIN</div>
          </div>
        </div>
        <h1 style={{ margin: '14px 0 2px', fontSize: 20, fontWeight: 800, color: '#fff' }}>Superadmin Access</h1>
        <p style={{ margin: '0 0 20px', fontSize: 12.5, color: '#8b8eb8' }}>Restricted area. All access attempts are logged.</p>

        {error && <div role="alert" style={{ fontSize: 13, color: '#fca5a5', backgroundColor: 'rgba(220,38,38,0.12)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>{error}</div>}

        {step === 'credentials' && (
          <form onSubmit={submitCredentials} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label htmlFor="sa-email" style={labelStyle}>Email</label>
              <input id="sa-email" value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" placeholder="admin@example.com" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="sa-password" style={labelStyle}>Password</label>
              <input id="sa-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" style={inputStyle} />
            </div>
            <button type="submit" disabled={busy} style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: busy ? '#3b3f7a' : 'linear-gradient(135deg,#6b5cf6,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', width: '100%' }}>
              {busy ? 'Checking…' : 'Login as Superadmin'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" onClick={() => { setStep('forgot-identifier'); setError(''); }} style={{ border: 'none', background: 'none', color: '#a99fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>Forgot Password</button>
              <Link href="/superadmin/signup" style={{ color: '#8b8eb8', fontWeight: 600, fontSize: 12.5, textDecoration: 'none' }}>First-time setup →</Link>
            </div>
          </form>
        )}

        {step === 'forgot-identifier' && (
          <form onSubmit={startForgot} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, color: '#aeb0d4' }}>Enter your Superadmin email or mobile to receive a reset code.</div>
            <div>
              <label htmlFor="sa-forgot" style={labelStyle}>Email or mobile</label>
              <input id="sa-forgot" value={forgotIdentifier} onChange={e => setForgotIdentifier(e.target.value)} autoComplete="username" style={inputStyle} />
            </div>
            <button type="submit" disabled={busy} style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: busy ? '#3b3f7a' : 'linear-gradient(135deg,#6b5cf6,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', width: '100%' }}>
              {busy ? 'Sending…' : 'Send Reset Code'}
            </button>
            <button type="button" onClick={() => { setStep('credentials'); setError(''); }} style={{ border: 'none', background: 'none', color: '#8b8eb8', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0, alignSelf: 'flex-start' }}>← Back to login</button>
          </form>
        )}

        {step === 'channel-select' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: '#aeb0d4' }}>Choose where to receive the verification code.</div>
            {(['EMAIL', 'WHATSAPP'] as const).map(ch => {
              const dest = ch === 'EMAIL' ? channels.email : channels.whatsapp;
              if (!dest) return null;
              return (
                <button key={ch} type="button" onClick={() => requestOtp(ch)} disabled={busy} style={{ padding: '12px 14px', borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2d63', background: '#0d0f2b', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  {ch === 'EMAIL' ? '✉️ Email' : '💬 WhatsApp'} <span style={{ fontWeight: 400, color: '#8b8eb8' }}>{dest}</span>
                </button>
              );
            })}
            <button type="button" onClick={() => { setStep('credentials'); setError(''); }} style={{ border: 'none', background: 'none', color: '#8b8eb8', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0, alignSelf: 'flex-start' }}>← Back</button>
          </div>
        )}

        {step === 'otp-entry' && (
          <SuperadminOtpPanel
            challengeId={challengeId}
            onBack={() => setStep('channel-select')}
            onVerified={data => {
              if (data.canResetPassword) setStep('reset-password');
              else confirmRoleAndEnter();
            }}
          />
        )}

        {step === 'reset-password' && (
          <form onSubmit={resetPassword} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, color: '#aeb0d4' }}>Code verified. Set a new password.</div>
            <div>
              <label htmlFor="sa-newpw" style={labelStyle}>New password</label>
              <input id="sa-newpw" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {PASSWORD_REQUIREMENTS.map(r => (
                  <span key={r.key} style={{ fontSize: 11.5, color: '#8b8eb8' }}>• {r.label}</span>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="sa-confirmpw" style={labelStyle}>Confirm password</label>
              <input id="sa-confirmpw" type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
            </div>
            <button type="submit" disabled={busy} style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: busy ? '#3b3f7a' : 'linear-gradient(135deg,#6b5cf6,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', width: '100%' }}>
              {busy ? 'Saving…' : 'Set New Password'}
            </button>
          </form>
        )}

        {step === 'reset-done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#6ee7b7', fontWeight: 700 }}>Password updated. Please log in with the new password.</div>
            <button type="button" onClick={() => { setStep('credentials'); setPassword(''); setNewPassword(''); setConfirmNewPassword(''); setError(''); }} style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#6b5cf6,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>Back to Login</button>
          </div>
        )}

        <div style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid #2a2d63', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6f72a0' }}>🔒 Superadmin access is monitored</span>
          <Link href="/login-signup" style={{ fontSize: 11.5, color: '#8b8eb8', textDecoration: 'none' }}>Normal user login →</Link>
        </div>
      </div>
    </div>
  );
}
