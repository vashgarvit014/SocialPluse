'use client';

import { clearAllUserState } from '@/lib/client-identity';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SuperadminOtpPanel from '../otp-panel';
import Mascot, { type MascotState } from './mascot';
import { loginIdentifierSchema, passwordSchema } from '@/lib/auth/schemas';
import { PASSWORD_REQUIREMENTS } from '@/lib/auth/password-rules';

type Step = 'credentials' | 'forgot-identifier' | 'channel-select' | 'otp-entry' | 'reset-password' | 'reset-done';
type Channel = 'EMAIL' | 'WHATSAPP';
// Animation phases. React owns this and every visual class is derived from it
// in the JSX below — no imperative classList writes, which get silently wiped
// on the next re-render.
type Phase = 'idle' | 'doorOpen' | 'walking' | 'happy';

const DOOR_MS = 380;
const WALK_MS = 680;
const HAPPY_MS = 700;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c5 0 9 4.5 9 6 0 .7-.6 1.7-1.7 2.7" />
          <path d="M6.3 8.3C4 9.8 3 11.6 3 12c0 1.5 4 6 9 6 1 0 1.9-.2 2.7-.5" />
          <path d="M9.9 10a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Each password field owns its reveal state: hidden by default, revealed only
// if that specific field is asked for. Focus + visibility are reported upward
// so the mascot state machine has one source of truth.
function PasswordField({
  id, value, onChange, autoComplete, placeholder, show, onToggle, onFocus, onBlur, children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  show: boolean;
  onToggle: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="sa-field">
      <input
        id={id}
        className="sa-input is-password"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <button
        className="sa-eye"
        type="button"
        // Without this, mousedown on the button blurs the input and the
        // mascot would drop straight back to neutral the moment you reveal
        // the password — defeating the whole "mascot peeks" behaviour.
        onMouseDown={e => e.preventDefault()}
        onClick={onToggle}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        tabIndex={-1}
      >
        <EyeIcon off={!show} />
      </button>
      {children}
    </div>
  );
}

function DoorScene() {
  return (
    <span className="sa-door">
      <span className="sa-door__frame" />
      <span className="sa-door__panel" />
      <span className="sa-person">
        <span className="sa-person__head" />
        <span className="sa-person__body" />
        <span className="sa-person__legs" />
      </span>
    </span>
  );
}

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function SuperadminLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Local-only: ?animationDebug=1 replays the CSS sequence with no auth call.
  // Never shown otherwise, gated to non-production, and grants nothing.
  const debug = searchParams.get('animationDebug') === '1' && process.env.NODE_ENV !== 'production';

  const [step, setStep] = useState<Step>('credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [channels, setChannels] = useState<{ email?: string | null; whatsapp?: string | null }>({});
  const [challengeId, setChallengeId] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState('');
  const [codeExpiresAt, setCodeExpiresAt] = useState('');
  // Where the OTP screen's Back should go — the form the code actually came
  // from, never a screen the user never used.
  const [otpBackStep, setOtpBackStep] = useState<Step>('channel-select');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');

  // ---- mascot state machine ----
  // Single source of truth for what the mascot is doing. Priority order:
  // transient auth outcomes > focus/visibility of the fields > neutral.
  const [focusedField, setFocusedField] = useState<'email' | 'sa-password' | 'sa-newpw' | 'sa-confirmpw' | null>(null);
  const [passwordShown, setPasswordShown] = useState(false);
  const [newPwShown, setNewPwShown] = useState(false);
  const [confirmPwShown, setConfirmPwShown] = useState(false);
  // The mascot reads whichever password field is actually focused. If the
  // form changes while a field still has DOM focus, the step transitions
  // below clear this explicitly.
  const passwordShownNow =
    focusedField === 'sa-password' ? passwordShown
    : focusedField === 'sa-newpw' ? newPwShown
    : focusedField === 'sa-confirmpw' ? confirmPwShown
    : step === 'reset-password' ? newPwShown || confirmPwShown
    : passwordShown;
  const [mascotOverride, setMascotOverride] = useState<MascotState | null>(null);
  const [errorPulse, setErrorPulse] = useState(false);
  const [successPulse, setSuccessPulse] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mascotState: MascotState =
    mascotOverride ??
    (successPulse ? 'success' : errorPulse ? 'error'
      : focusedField === 'sa-password' || focusedField === 'sa-newpw' || focusedField === 'sa-confirmpw'
        ? (passwordShownNow ? 'passwordVisible' : 'passwordHidden')
      : focusedField === 'email' ? 'emailFocus'
      : 'neutral');

  // Brief, self-clearing reaction so the mascot returns to its form-driven
  // state on its own instead of latching after a failed or successful attempt.
  function pulse(kind: 'error' | 'success') {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    if (kind === 'error') setErrorPulse(true); else setSuccessPulse(true);
    pulseTimer.current = setTimeout(() => {
      setErrorPulse(false);
      setSuccessPulse(false);
    }, kind === 'error' ? 900 : 700);
  }

  useEffect(() => () => { if (pulseTimer.current) clearTimeout(pulseTimer.current); }, []);

  // Reset to true *inside* the effect: StrictMode's dev double-mount runs the
  // cleanup, so setting it only at useRef() time leaves it false forever and
  // kills the sequence right after the first await.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Door opens -> person walks through -> mascot reacts. Every step is awaited
  // so navigation can never cut the animation short. The mascot's happy
  // reaction is the LAST beat, not the whole sequence.
  async function playSequence() {
    setPhase('doorOpen');
    await wait(DOOR_MS);
    if (!aliveRef.current) return;
    setPhase('walking');
    await wait(WALK_MS);
    if (!aliveRef.current) return;
    setPhase('happy');
    setSuccessPulse(true);
    await wait(HAPPY_MS);
    if (!aliveRef.current) return;
    setPhase('idle');
    setSuccessPulse(false);
  }

  async function confirmRoleAndEnter() {
    const res = await fetch('/api/superadmin/auth/check');
    if (!res.ok) {
      await fetch('/api/auth/logout', { method: 'POST' });
      // Rejecting a non-admin account must also drop whatever client state the
      // previous session left behind, so the next attempt starts clean.
      await clearAllUserState();
      setError('This account is not a Superadmin.');
      pulse('error');
      setFocusedField(null);
      setStep('credentials');
      return;
    }
    // The session already exists; hold the screen until the animation lands.
    await playSequence();
    if (!aliveRef.current) return;
    router.replace('/superadmin');
    router.refresh();
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!loginIdentifierSchema.safeParse(identifier).success) { setError('Enter a valid email or mobile number.'); pulse('error'); return; }
    if (!password) { setError('Enter your password.'); pulse('error'); return; }
    setBusy(true);

    let ok = false;
    try {
      // Validate FIRST. A bad password returns here with no door animation.
      const { ok: good, data } = await postJson('/api/superadmin/auth/login', { identifier, password });
      if (!good) {
        setError(typeof data.error === 'string' ? data.error : 'Login failed.');
        pulse('error');
        return;
      }
      setChannels((data.channels as { email?: string; whatsapp?: string | null }) || {});
      ok = true;
    } catch {
      setError('Network error. Please try again.');
      pulse('error');
      return;
    } finally {
      setBusy(false);
    }

    if (!ok) return;
    // Credentials accepted — celebrate, then ask where to send the code.
    await playSequence();
    if (!aliveRef.current) return;
    setStep('channel-select');
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
      setResendAvailableAt(typeof data.resendAvailableAt === 'string' ? data.resendAvailableAt : '');
      setCodeExpiresAt(typeof data.expiresAt === 'string' ? data.expiresAt : '');
      setOtpBackStep('forgot-identifier');
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
      setResendAvailableAt(typeof data.resendAvailableAt === 'string' ? data.resendAvailableAt : '');
      setCodeExpiresAt(typeof data.expiresAt === 'string' ? data.expiresAt : '');
      setOtpBackStep('channel-select');
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

  const animating = phase === 'doorOpen' || phase === 'walking' || phase === 'happy';
  const doorClass = phase === 'doorOpen' || phase === 'walking' ? 'dooropen' : '';
  const walkingClass = phase === 'walking' ? 'walking' : '';
  const locked = busy || animating;

  const onSignInButton = step === 'credentials' || step === 'reset-password';

  return (
    <div className="sa-page">
      <div className="sa-glow" />
      <div className="sa-wrap">
        <Mascot state={mascotState} />

        <div className="sa-card">
          <h1 className="sa-title">SocialPulse</h1>
          <p className="sa-sub"><strong>Secure Superadmin Access.</strong> All access attempts are logged.</p>

          <div className="sa-error" role="alert">{error}</div>

          {step === 'credentials' && (
            <form onSubmit={submitCredentials} noValidate>
              <div className="sa-field">
                <label htmlFor="sa-email">Email</label>
                <input
                  id="sa-email"
                  className="sa-input"
                  type="email"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  autoComplete="username"
                  disabled={locked}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(f => (f === 'email' ? null : f))}
                  required
                />
              </div>

              <PasswordField
                id="sa-password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                placeholder="Password"
                show={passwordShown}
                onToggle={() => setPasswordShown(v => !v)}
                onFocus={() => setFocusedField('sa-password')}
                onBlur={() => setFocusedField(f => (f === 'sa-password' ? null : f))}
              />

              <div className="sa-options">
                <span style={{ fontSize: 12, color: '#6b7688' }}>Seeded accounts only</span>
                <button type="button" className="sa-link" onClick={() => { setStep('forgot-identifier'); setError(''); }} disabled={locked}>
                  Forgot password?
                </button>
              </div>

              <button className={`sa-btn ${doorClass} ${walkingClass}`} type="submit" disabled={locked}>
                <span className="sa-btn__label">{busy ? 'Checking…' : animating ? 'Welcome' : 'Sign in'}</span>
                <DoorScene />
              </button>

              {debug && (
                <>
                  <button className="sa-test" type="button" onClick={() => { if (!locked) void playSequence(); }}>
                    Test Animation
                  </button>
                  <div className="sa-debug">
                    {(['neutral', 'emailFocus', 'passwordHidden', 'passwordVisible', 'error', 'success'] as MascotState[]).map(s => (
                      <button
                        key={s}
                        type="button"
                        className="sa-debug__btn"
                        data-active={mascotOverride === s}
                        onClick={() => setMascotOverride(cur => (cur === s ? null : s))}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </form>
          )}

          {step === 'forgot-identifier' && (
            <form onSubmit={startForgot} noValidate>
              <p className="sa-hint">Enter your Superadmin email or mobile to receive a reset code.</p>
              <div className="sa-field">
                <label htmlFor="sa-forgot">Email or mobile</label>
                <input
                  id="sa-forgot"
                  className="sa-input"
                  type="text"
                  value={forgotIdentifier}
                  onChange={e => setForgotIdentifier(e.target.value)}
                  autoComplete="username"
                  disabled={busy}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(f => (f === 'email' ? null : f))}
                  required
                />
              </div>
              <button className="sa-btn" type="submit" disabled={busy} style={{ background: busy ? '#1d3a63' : undefined }}>
                <span className="sa-btn__label">{busy ? 'Sending…' : 'Send Reset Code'}</span>
              </button>
              <div className="sa-foot sa-foot-alt">
                <button type="button" className="sa-link muted" onClick={() => { setStep('credentials'); setError(''); }} disabled={busy}>
                  ← Back to login
                </button>
              </div>
            </form>
          )}

          {step === 'channel-select' && (
            <div>
              <p className="sa-hint">Choose where to receive the verification code.</p>
              <div className="sa-channels">
                {(['EMAIL', 'WHATSAPP'] as const).map(ch => {
                  const dest = ch === 'EMAIL' ? channels.email : channels.whatsapp;
                  if (!dest) return null;
                  return (
                    <button key={ch} type="button" className="sa-channel" onClick={() => requestOtp(ch)} disabled={busy}>
                      {ch === 'EMAIL' ? '✉️ Email' : '💬 WhatsApp'} <span>{dest}</span>
                    </button>
                  );
                })}
              </div>
              <div className="sa-foot sa-foot-alt">
                <button type="button" className="sa-link muted" onClick={() => { setStep('credentials'); setError(''); }} disabled={busy}>
                  ← Back
                </button>
              </div>
            </div>
          )}

          {step === 'otp-entry' && (
            <>
              <p className="sa-hint">Verify your identity</p>
              {channels.email && <p className="sa-notice">We sent a code to {channels.email}</p>}
              <SuperadminOtpPanel
                challengeId={challengeId}
                resendAvailableAt={resendAvailableAt}
                expiresAt={codeExpiresAt}
                onResent={setCodeExpiresAt}
                onBack={() => { setError(''); setResendAvailableAt(''); setStep(otpBackStep); }}
                onVerified={async data => {
                  if (data.canResetPassword) setStep('reset-password');
                  else await confirmRoleAndEnter();
                }}
              />
            </>
          )}

          {step === 'reset-password' && (
            <form onSubmit={resetPassword} noValidate>
              <p className="sa-hint">Code verified. Set a new password.</p>
              <PasswordField
                id="sa-newpw"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                show={newPwShown}
                onToggle={() => setNewPwShown(v => !v)}
                onFocus={() => setFocusedField('sa-newpw')}
                onBlur={() => setFocusedField(f => (f === 'sa-newpw' ? null : f))}
              >
                <div className="sa-rules">
                  {PASSWORD_REQUIREMENTS.map(r => (
                    <span key={r.key} style={{ color: r.test(newPassword) ? '#6ee7b7' : '#8a93a4' }}>
                      {r.test(newPassword) ? '✓' : '•'} {r.label}
                    </span>
                  ))}
                </div>
              </PasswordField>
              <PasswordField
                id="sa-confirmpw"
                value={confirmNewPassword}
                onChange={setConfirmNewPassword}
                autoComplete="new-password"
                show={confirmPwShown}
                onToggle={() => setConfirmPwShown(v => !v)}
                onFocus={() => setFocusedField('sa-confirmpw')}
                onBlur={() => setFocusedField(f => (f === 'sa-confirmpw' ? null : f))}
              />
              <button className={`sa-btn ${doorClass} ${walkingClass}`} type="submit" disabled={locked}>
                <span className="sa-btn__label">{busy ? 'Saving…' : 'Set New Password'}</span>
                <DoorScene />
              </button>
            </form>
          )}

          {step === 'reset-done' && (
            <div>
              <p className="sa-hint" style={{ color: '#6ee7b7', fontWeight: 700 }}>Password updated. Please sign in with the new password.</p>
              <button
                className="sa-btn"
                type="button"
                onClick={() => { setStep('credentials'); setPassword(''); setNewPassword(''); setConfirmNewPassword(''); setError(''); }}
              >
                <span className="sa-btn__label">Back to Sign in</span>
              </button>
            </div>
          )}

          <p className="sa-foot">
            <LockIcon />
            Protected SocialPulse administrative portal
          </p>
        </div>
      </div>
    </div>
  );
}
