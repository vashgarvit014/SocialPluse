'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import OtpInput from '@/app/login-signup/otp-input';
import { avatarColor, initials } from '../ui';
import { PASSWORD_REQUIREMENTS } from '@/lib/auth/password-rules';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 9,
  borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--bd)',
  background: 'var(--sf)', color: 'var(--tx)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 };

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '11px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 700, color: '#fff',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.7 : 1,
  background: 'linear-gradient(135deg, var(--ac), var(--act))', fontFamily: 'inherit',
});

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const head = local.slice(0, 2);
  return `${head}***@${domain}`;
}

export default function SettingsClient({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  // ---- password form ----
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- email form ----
  const [currentEmail, setCurrentEmail] = useState(email);
  const [newEmail, setNewEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    setPwMsg(null);
    setPwBusy(true);
    try {
      const res = await fetch('/api/superadmin/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwMsg({ ok: false, text: typeof data.error === 'string' ? data.error : 'Could not change the password.' });
        return;
      }
      setPwMsg({
        ok: true,
        text: data.notified === false
          ? 'Superadmin password changed. Other sessions were signed out. (Confirmation email could not be sent.)'
          : 'Superadmin password changed. Other sessions were signed out, and a confirmation email was sent to this address.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      router.refresh();
    } catch {
      setPwMsg({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setPwBusy(false);
    }
  }

  async function requestEmailOtp(e: FormEvent) {
    e.preventDefault();
    if (emailBusy) return;
    setEmailMsg(null);
    setEmailBusy(true);
    try {
      const res = await fetch('/api/superadmin/settings/email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailMsg({ ok: false, text: typeof data.error === 'string' ? data.error : 'Could not send the code.' });
        return;
      }
      setChallengeId(typeof data.challengeId === 'string' ? data.challengeId : '');
      setCode('');
      setEmailMsg({ ok: true, text: `Code sent to ${maskEmail(newEmail.trim())}.` });
    } catch {
      setEmailMsg({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setEmailBusy(false);
    }
  }

  async function verifyEmailOtp() {
    if (emailBusy || code.trim().length !== 6) return;
    setEmailBusy(true);
    setEmailMsg(null);
    try {
      const res = await fetch('/api/superadmin/settings/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, otp: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailMsg({ ok: false, text: typeof data.error === 'string' ? data.error : 'Verification failed.' });
        return;
      }
      setCurrentEmail(typeof data.email === 'string' ? data.email : newEmail.trim().toLowerCase());
      setNewEmail('');
      setChallengeId('');
      setCode('');
      setEmailMsg({ ok: true, text: 'Email address updated.' });
      router.refresh();
    } catch {
      setEmailMsg({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setEmailBusy(false);
    }
  }

  async function resendEmailOtp() {
    if (emailBusy) return;
    setEmailBusy(true);
    try {
      const res = await fetch('/api/superadmin/settings/email/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId }),
      });
      const data = await res.json();
      setEmailMsg(res.ok
        ? { ok: true, text: 'A new code was sent.' }
        : { ok: false, text: typeof data.error === 'string' ? data.error : 'Could not resend the code.' });
    } catch {
      setEmailMsg({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: avatarColor(name), color: '#fff', fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(name)}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--mu)', marginTop: 2 }}>{currentEmail}</div>
        </div>
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--mu)', marginBottom: 4 }}>ACCOUNT</div>
        <div style={{ fontSize: 12.5, color: 'var(--mu)', marginBottom: 6 }}>Current Email</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{currentEmail}</div>

        {!challengeId ? (
          <form onSubmit={requestEmailOtp} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label htmlFor="sa-new-email" style={labelStyle}>New Email</label>
              <input id="sa-new-email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="new@example.com" autoComplete="email" style={inputStyle} />
            </div>
            {emailMsg && <div style={{ fontSize: 13, color: emailMsg.ok ? 'var(--ok)' : 'var(--bad)', background: emailMsg.ok ? 'var(--oks)' : 'var(--bads)', padding: '10px 14px', borderRadius: 9 }}>{emailMsg.text}</div>}
            <div><button type="submit" disabled={emailBusy} style={primaryBtn(emailBusy)}>Change Email</button></div>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--mu)' }}>We sent a verification code to <strong>{maskEmail(newEmail.trim())}</strong>. The address updates only after the code verifies.</div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <OtpInput value={code} onChange={setCode} disabled={emailBusy} />
            </div>
            {emailMsg && <div style={{ fontSize: 13, color: emailMsg.ok ? 'var(--ok)' : 'var(--bad)', background: emailMsg.ok ? 'var(--oks)' : 'var(--bads)', padding: '10px 14px', borderRadius: 9 }}>{emailMsg.text}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={verifyEmailOtp} disabled={emailBusy || code.trim().length !== 6} style={{ ...primaryBtn(emailBusy || code.trim().length !== 6), flex: 1 }}>Verify &amp; Change Email</button>
              <button type="button" onClick={resendEmailOtp} disabled={emailBusy} style={{ padding: '11px 14px', borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--tx)', fontSize: 13, fontWeight: 700, cursor: emailBusy ? 'default' : 'pointer', fontFamily: 'inherit' }}>Resend</button>
            </div>
            <button type="button" onClick={() => { setChallengeId(''); setCode(''); setEmailMsg(null); }} style={{ border: 'none', background: 'none', color: 'var(--mu)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0, alignSelf: 'flex-start' }}>← Use a different email</button>
          </div>
        )}
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--mu)', marginBottom: 4 }}>SECURITY</div>
        <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 14 }}>Changing the Superadmin password signs out every other session and emails a confirmation to {maskEmail(currentEmail)}.</div>
        <form onSubmit={submitPassword} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="sa-current-pw" style={labelStyle}>Current Password</label>
            <input id="sa-current-pw" type={showPw ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="sa-new-pw" style={labelStyle}>New Password</label>
            <input id="sa-new-pw" type={showPw ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {PASSWORD_REQUIREMENTS.map(r => (
                <span key={r.key} style={{ fontSize: 11.5, color: r.test(newPassword) ? 'var(--ok)' : 'var(--mu)' }}>{r.test(newPassword) ? '✓' : '•'} {r.label}</span>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="sa-confirm-pw" style={labelStyle}>Confirm New Password</label>
            <input id="sa-confirm-pw" type={showPw ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
          </div>
          {pwMsg && <div style={{ fontSize: 13, color: pwMsg.ok ? 'var(--ok)' : 'var(--bad)', background: pwMsg.ok ? 'var(--oks)' : 'var(--bads)', padding: '10px 14px', borderRadius: 9 }}>{pwMsg.text}</div>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" disabled={pwBusy} style={primaryBtn(pwBusy)}>{pwBusy ? 'Saving…' : 'Change Password'}</button>
            <button type="button" onClick={() => setShowPw(v => !v)} style={{ padding: '11px 14px', borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--tx)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{showPw ? 'Hide' : 'Show'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
