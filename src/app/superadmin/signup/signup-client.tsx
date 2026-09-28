'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SuperadminOtpPanel from '../otp-panel';
import { nameSchema, emailSchema, mobileSchema, passwordSchema } from '@/lib/auth/schemas';

type Step = 'details' | 'channel-select' | 'otp-entry';
type Channel = 'EMAIL' | 'WHATSAPP';
type FieldErrors = Partial<Record<'name' | 'email' | 'mobile' | 'password' | 'confirm' | 'secret', string>>;

const card: React.CSSProperties = {
  width: '100%', maxWidth: 460, backgroundColor: '#15173a', borderRadius: 18,
  borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2d63',
  boxShadow: '0 24px 64px rgba(0,0,0,0.45)', padding: '30px 28px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2d63',
  fontSize: 14, color: '#fff', backgroundColor: '#0d0f2b', outline: 'none', fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#aeb0d4', marginBottom: 6, display: 'block' };

function Field({ id, label, type = 'text', value, onChange, error, placeholder, autoComplete }: {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void;
  error?: string; placeholder?: string; autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input
        id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        style={{ ...inputStyle, ...(error ? { borderColor: '#f87171' } : {}) }}
      />
      {error && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 5 }}>{error}</div>}
    </div>
  );
}

export default function SuperadminSignupClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FieldErrors, boolean>>>({});
  const [channels, setChannels] = useState<{ email?: string | null; whatsapp?: string | null }>({});
  const [challengeId, setChallengeId] = useState('');
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    const n = nameSchema.safeParse(name);
    if (!n.success) e.name = n.error.issues[0]?.message;
    const em = emailSchema.safeParse(email);
    if (!em.success) e.email = em.error.issues[0]?.message;
    const m = mobileSchema.safeParse(mobile);
    if (!m.success) e.mobile = m.error.issues[0]?.message;
    const p = passwordSchema.safeParse(password);
    if (!p.success) e.password = p.error.issues[0]?.message;
    else if (password !== confirm) e.confirm = 'Passwords do not match.';
    if (!secret) e.secret = 'Setup secret is required.';
    return e;
  }

  const live = validate();
  const show = (k: keyof FieldErrors) => (touched[k] ? errors[k] || live[k] : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, mobile: true, password: true, confirm: true, secret: true });
    if (Object.keys(live).length > 0) { setErrors(live); return; }
    setBusy(true);
    setBanner('');
    try {
      const res = await fetch('/api/superadmin/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, mobile, password, setupSecret: secret }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fields) setErrors(data.fields);
        else setBanner(data.error || 'Could not create the Superadmin account.');
        return;
      }
      setChannels(data.channels || {});
      setSecret('');
      setStep('channel-select');
    } catch {
      setBanner('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(ch: Channel) {
    if (busy) return;
    setBusy(true);
    setBanner('');
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: ch }),
      });
      const data = await res.json();
      if (!res.ok) { setBanner(data.error || 'Could not send the code.'); return; }
      setChallengeId(typeof data.challengeId === 'string' ? data.challengeId : '');
      setStep('otp-entry');
    } catch {
      setBanner('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRoleAndEnter() {
    const res = await fetch('/api/superadmin/auth/check');
    if (res.ok) router.replace('/superadmin');
    else {
      await fetch('/api/auth/logout', { method: 'POST' });
      setBanner('Account created, but role verification failed. Please log in.');
      setStep('details');
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
        <h1 style={{ margin: '14px 0 2px', fontSize: 20, fontWeight: 800, color: '#fff' }}>Superadmin Setup</h1>
        <p style={{ margin: '0 0 20px', fontSize: 12.5, color: '#8b8eb8' }}>Local bootstrap only — requires the server setup secret. Never share it.</p>

        {banner && <div role="alert" style={{ fontSize: 13, color: '#fca5a5', backgroundColor: 'rgba(220,38,38,0.12)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>{banner}</div>}

        {step === 'details' && (
          <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <Field id="ss-name" label="Full Name" value={name} onChange={v => { setName(v); setTouched(t => ({ ...t, name: true })); }} error={show('name')} placeholder="Jane Doe" autoComplete="name" />
            <Field id="ss-email" label="Email" value={email} onChange={v => { setEmail(v); setTouched(t => ({ ...t, email: true })); }} error={show('email')} placeholder="admin@example.com" autoComplete="email" />
            <Field id="ss-mobile" label="Mobile" value={mobile} onChange={v => { setMobile(v); setTouched(t => ({ ...t, mobile: true })); }} error={show('mobile')} placeholder="+919876543210" autoComplete="tel" />
            <Field id="ss-password" label="Password" type="password" value={password} onChange={v => { setPassword(v); setTouched(t => ({ ...t, password: true })); }} error={show('password')} autoComplete="new-password" />
            <Field id="ss-confirm" label="Confirm Password" type="password" value={confirm} onChange={v => { setConfirm(v); setTouched(t => ({ ...t, confirm: true })); }} error={show('confirm')} autoComplete="new-password" />
            <Field id="ss-secret" label="Setup Secret" type="password" value={secret} onChange={v => { setSecret(v); setTouched(t => ({ ...t, secret: true })); }} error={show('secret')} placeholder="Server setup secret" autoComplete="off" />
            <button type="submit" disabled={busy} style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: busy ? '#3b3f7a' : 'linear-gradient(135deg,#6b5cf6,#8b5cf6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', width: '100%' }}>
              {busy ? 'Creating…' : 'Create Superadmin'}
            </button>
            <Link href="/superadmin/login" style={{ color: '#8b8eb8', fontWeight: 600, fontSize: 12.5, textDecoration: 'none', alignSelf: 'flex-start' }}>← Back to Superadmin login</Link>
          </form>
        )}

        {step === 'channel-select' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: '#aeb0d4' }}>Account created as PENDING. Choose where to receive the activation code.</div>
            {(['EMAIL', 'WHATSAPP'] as const).map(ch => {
              const dest = ch === 'EMAIL' ? channels.email : channels.whatsapp;
              if (!dest) return null;
              return (
                <button key={ch} type="button" onClick={() => requestOtp(ch)} disabled={busy} style={{ padding: '12px 14px', borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: '#2a2d63', background: '#0d0f2b', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  {ch === 'EMAIL' ? '✉️ Email' : '💬 WhatsApp'} <span style={{ fontWeight: 400, color: '#8b8eb8' }}>{dest}</span>
                </button>
              );
            })}
          </div>
        )}

        {step === 'otp-entry' && (
          <SuperadminOtpPanel challengeId={challengeId} onBack={() => setStep('channel-select')} onVerified={() => confirmRoleAndEnter()} />
        )}

        <div style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid #2a2d63', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6f72a0' }}>🔒 Setup attempts are monitored</span>
          <Link href="/login-signup" style={{ fontSize: 11.5, color: '#8b8eb8', textDecoration: 'none' }}>Normal user login →</Link>
        </div>
      </div>
    </div>
  );
}
