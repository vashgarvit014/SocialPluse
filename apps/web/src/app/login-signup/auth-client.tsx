'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { ZodType } from 'zod';
import OtpInput from './otp-input';
import { SP_LOGO } from '@/app/_shell/brand-assets';
import { nameSchema, emailSchema, mobileSchema, passwordSchema, loginIdentifierSchema } from '@/lib/auth/schemas';
import { PASSWORD_REQUIREMENTS } from '@/lib/auth/password-rules';

type Mode = 'login' | 'signup';
type Purpose = 'SIGNUP_VERIFY' | 'LOGIN_VERIFY' | 'PASSWORD_RESET';
type Step = 'credentials' | 'forgot-identifier' | 'channel-select' | 'otp-entry' | 'reset-password' | 'reset-done';
type Channel = 'EMAIL' | 'WHATSAPP';
type FieldErrors = Partial<Record<string, string>>;

// Non-shorthand border properties throughout this file on purpose:
// inputErrorStyle only overrides borderColor, and mixing a shorthand
// `border` with a non-shorthand `borderColor` across a rerender is a real
// React styling bug (triggers Next's dev error overlay, not just a lint nit).
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#e2e8f0',
  fontSize: 14,
  color: '#0f172a',
  backgroundColor: '#fff',
  outline: 'none',
  fontFamily: 'inherit',
};

const inputErrorStyle: React.CSSProperties = {
  borderColor: '#dc2626',
  boxShadow: '0 0 0 3px rgba(220,38,38,0.08)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#334155',
  marginBottom: 6,
  display: 'block',
};

const fieldErrorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#dc2626',
  marginTop: 5,
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '13px 0',
  borderRadius: 12,
  border: 'none',
  background: disabled ? '#a5a6f0' : 'linear-gradient(135deg,#5b6cff,#8b5cf6)',
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  cursor: disabled ? 'default' : 'pointer',
  boxShadow: '0 10px 24px rgba(91,76,245,.3)',
  fontFamily: 'inherit',
  width: '100%',
});

// Runs the same schema the server enforces — a field only ever shows an
// error after the user has interacted with it (see `touched`), never on
// first render.
function validateField(schema: ZodType, value: string): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ fontSize: 13, color: '#dc2626', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px' }}>
      {message}
    </div>
  );
}

function TextField({
  id, label, type = 'text', value, onChange, onBlur, error, autoComplete, placeholder, inputMode,
}: {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void; onBlur: () => void;
  error?: string; autoComplete: string; placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
        style={{ ...inputStyle, ...(error ? inputErrorStyle : {}) }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && <p id={errorId} style={fieldErrorTextStyle}>{error}</p>}
    </div>
  );
}

function PasswordField({
  id, label, value, onChange, onBlur, error, autoComplete, placeholder, showRequirements,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  error?: string; autoComplete: string; placeholder?: string; showRequirements?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const reqId = `${id}-requirements`;
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          placeholder={placeholder}
          style={{ ...inputStyle, paddingRight: 44, ...(error ? inputErrorStyle : {}) }}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? errorId : null, showRequirements ? reqId : null].filter(Boolean).join(' ') || undefined}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8',
            fontSize: 12, fontWeight: 600, padding: '6px 8px', borderRadius: 6,
          }}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {error && <p id={errorId} style={fieldErrorTextStyle}>{error}</p>}
      {showRequirements && (
        <div id={reqId} style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          {PASSWORD_REQUIREMENTS.map(req => {
            const met = req.test(value);
            return (
              <span key={req.key} style={{ fontSize: 11.5, color: met ? '#16a34a' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span aria-hidden="true">{met ? '✓' : '○'}</span>{req.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BrandHeader() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <img src={SP_LOGO} alt="SocialPulse logo" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'cover', boxShadow: '0 8px 20px rgba(91,76,245,.35)' }} />
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: '#0f1020' }}>SocialPulse</span>
      </Link>
      <p style={{ marginTop: 10, fontSize: 14, color: '#64748b' }}>Welcome to SocialPulse</p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: '28px 28px 32px', boxShadow: '0 20px 50px rgba(15,23,42,0.08)', border: '1px solid #eef0f6' }}>
      {children}
    </div>
  );
}

function useCountdown(targetIso: string | null) {
  const [msLeft, setMsLeft] = useState(0);
  useEffect(() => {
    if (!targetIso) return;
    const target = new Date(targetIso).getTime();
    const tick = () => setMsLeft(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return targetIso ? msLeft : 0;
}

// Strips Next-internal query params from a callbackUrl before it is used as a
// post-verify redirect target. proxy.ts already does this when it builds the
// bounce, but an old bookmark, a hand-edited link, or a URL cached before that
// fix can still carry one — most importantly `__rsc`, which marks a URL as an
// RSC *payload* request. router.push() to such a URL does not change the route,
// so the card would sit on "Verifying…" forever. See callbackPathname() in
// src/proxy.ts for the same reasoning at the source.
function safeCallbackUrl(raw: string): string {
  const queryStart = raw.indexOf('?');
  if (queryStart === -1) return raw;
  const path = raw.slice(0, queryStart);
  const params = new URLSearchParams(raw.slice(queryStart + 1));
  for (const key of [...params.keys()]) {
    if (key.startsWith('__')) params.delete(key);
  }
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

export default function AuthClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl');
  const initialMode: Mode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';

  const [step, setStep] = useState<Step>('credentials');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Credentials form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [identifier, setIdentifier] = useState(''); // login: email or mobile
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<string, boolean>>>({});

  // Post-credentials state
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [channels, setChannels] = useState<{ email: string | null; whatsapp: string | null } | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [maskedDestination, setMaskedDestination] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const otpVerifyInFlightRef = useRef(false);
  const otpVerifiedRef = useRef(false);
  const redirectWatchdogRef = useRef<number | null>(null);

  // Never leave a pending forced-navigation timer behind.
  useEffect(() => () => {
    if (redirectWatchdogRef.current !== null) window.clearTimeout(redirectWatchdogRef.current);
  }, []);

  // Forgot-password identifier + reset-new-password
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetFieldErrors, setResetFieldErrors] = useState<FieldErrors>({});
  const [resetTouched, setResetTouched] = useState<Partial<Record<string, boolean>>>({});

  const resendMsLeft = useCountdown(resendAvailableAt);

  useEffect(() => {
    otpVerifyInFlightRef.current = false;
    otpVerifiedRef.current = false;
  }, [challengeId]);

  const markTouched = (field: string) => setTouched(t => ({ ...t, [field]: true }));
  const setFieldError = (field: string, message: string | undefined) =>
    setFieldErrors(prev => {
      if (message) return { ...prev, [field]: message };
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const blurValidate = (field: string, schema: ZodType, value: string) => {
    markTouched(field);
    setFieldError(field, validateField(schema, value));
  };

  const confirmPasswordError = (pw: string, confirm: string): string | undefined =>
    confirm && pw !== confirm ? 'Passwords do not match.' : undefined;

  // NOTE: submit buttons are deliberately NOT gated on live-computed
  // validity derived from this component's own state (name/email/password/
  // etc.). Browser/password-manager autofill can fill the visible input
  // without firing React's onChange in Chrome, leaving that state stuck at
  // "" while the field looks filled — which made Continue permanently
  // unclickable with no visible reason. The submit handlers already
  // re-validate from scratch (see handleCredentialsSubmit /
  // handleResetPassword) and show inline field errors before calling the
  // API, so that remains the single source of truth; only `submitting`
  // disables the button now, to prevent double-submits.

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(''); setInfo(''); setFieldErrors({}); setTouched({});
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', next);
      window.history.replaceState(null, '', url.toString());
    }
  };

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  // Server-side VALIDATION_ERROR responses (the defense-in-depth layer, in
  // case client-side checks were somehow bypassed) map onto the same inline
  // field errors rather than a generic banner.
  function applyServerError(data: { error?: string; fields?: Record<string, string> }, setFields: (f: FieldErrors) => void, setTouchedAll: (t: Record<string, boolean>) => void): boolean {
    if (data.error === 'VALIDATION_ERROR' && data.fields) {
      setFields(data.fields);
      setTouchedAll(Object.fromEntries(Object.keys(data.fields).map(k => [k, true])));
      return true;
    }
    return false;
  }

  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      const errors: FieldErrors = {
        name: validateField(nameSchema, name),
        email: validateField(emailSchema, email),
        mobile: validateField(mobileSchema, mobile),
        password: validateField(passwordSchema, password),
        confirmPassword: confirmPasswordError(password, confirmPassword),
      };
      setFieldErrors(errors);
      setTouched({ name: true, email: true, mobile: true, password: true, confirmPassword: true });
      if (Object.values(errors).some(Boolean)) return;
    } else {
      const idError = validateField(loginIdentifierSchema, identifier);
      setFieldErrors({ identifier: idError });
      setTouched({ identifier: true, password: true });
      if (idError) return;
    }

    setSubmitting(true);
    try {
      const { ok, data } = mode === 'login'
        ? await postJson('/api/auth/login', { identifier, password })
        : await postJson('/api/auth/signup', { name, email, mobile, password, confirmPassword });

      if (!ok) {
        if (!applyServerError(data, setFieldErrors, t => setTouched(prev => ({ ...prev, ...t })))) {
          setError(data.error || 'Something went wrong. Please try again.');
        }
        return;
      }

      // Server-issued redirect means the session is already authenticated and
      // no OTP step is required (currently: the Canva review account). Go
      // straight to the app. Any response without `redirect` is the normal
      // password-accepted-but-OTP-required path and continues unchanged below.
      if (data.redirect) {
        window.location.replace(data.redirect);
        return;
      }

      setPurpose(data.purpose);
      setChannels(data.channels);
      setStep('channel-select');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const requestOtp = async (channel: Channel) => {
    setError(''); setSubmitting(true);
    try {
      const { ok, data } = await postJson('/api/auth/otp/request', { channel });
      if (!ok) { setError(data.error || 'Could not send the verification code.'); return; }
      setChallengeId(data.challengeId);
      setResendAvailableAt(data.resendAvailableAt);
      setMaskedDestination(channel === 'EMAIL' ? (channels?.email || '') : (channels?.whatsapp || ''));
      setOtp('');
      setStep('otp-entry');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!forgotIdentifier.trim()) { setFieldErrors({ identifier: 'Please enter your email or mobile number.' }); setTouched({ identifier: true }); return; }
    setSubmitting(true);
    try {
      const { data } = await postJson('/api/auth/password/forgot', { identifier: forgotIdentifier });
      setPurpose('PASSWORD_RESET');
      setChallengeId(data.challengeId || '');
      setMaskedDestination(data.maskedDestination || 'your registered email or WhatsApp number');
      setResendAvailableAt(data.resendAvailableAt || null);
      setOtp('');
      setInfo(data.message);
      setStep('otp-entry');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const verifyOtp = async (code: string) => {
    if (code.length !== 6 || submitting || otpVerifyInFlightRef.current || otpVerifiedRef.current) return;
    otpVerifyInFlightRef.current = true;
    setError(''); setSubmitting(true);
    try {
      const { ok, data } = await postJson('/api/auth/otp/verify', { challengeId, otp: code });
      if (otpVerifiedRef.current) return;
      if (!ok) { setError(data.error || 'Verification failed.'); setOtp(''); return; }

      otpVerifiedRef.current = true;
      if (data.canResetPassword) {
        // The challenge is consumed, but we are NOT leaving the page — we
        // advance to the new-password form. `submitting` has to be released
        // here or that form's submit button (`disabled={submitting}`) stays
        // disabled forever and the reset can never be completed. The
        // `finally` below deliberately does not clear it on the success path,
        // because the login/signup branches rely on it to freeze the UI while
        // the redirect is in flight.
        setSubmitting(false);
        setStep('reset-password');
        return;
      }
      const target = callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//') ? safeCallbackUrl(callbackUrl) : (data.redirect || '/dashboard');
      // A SUPERADMIN who verified on the public site is handed the admin
      // ORIGIN (absolute), because /superadmin only exists on the admin
      // subdomain. router.push() is for same-origin client navigation; an
      // absolute cross-origin target needs a real document navigation.
      if (/^https?:\/\//i.test(target)) {
        window.location.assign(target);
        return;
      }
      // router.push() to the URL we are already on is a no-op, which would
      // leave the card frozen on "Verifying…" with no way out. A real
      // navigation guarantees the proxy re-runs (it bounces an
      // already-authenticated /login-signup to /dashboard).
      if (target === `${window.location.pathname}${window.location.search}`) {
        window.location.assign(target);
        return;
      }
      router.push(target);
      router.refresh();
      // router.push() is fire-and-forget: nothing reports back if it fails to
      // change the route, and on the success path `submitting` is deliberately
      // never released (see the finally below), so the card would sit on
      // "Verifying…" with no error and no way out. If the SPA navigation has
      // not happened shortly, force a real document navigation to the same
      // place. A user must never be stranded here after a successful verify.
      redirectWatchdogRef.current = window.setTimeout(() => {
        redirectWatchdogRef.current = null;
        window.location.assign(target);
      }, 6000);
    } catch {
      if (otpVerifiedRef.current) return;
      setError('Could not reach the server. Please try again.');
    } finally {
      if (!otpVerifiedRef.current) {
        otpVerifyInFlightRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const handleOtpChange = (value: string) => {
    setOtp(value);
    if (value.length === 6) verifyOtp(value);
  };

  const handleResend = async () => {
    setError(''); setSubmitting(true);
    try {
      const { ok, data } = await postJson('/api/auth/otp/resend', { challengeId });
      if (!ok) { setError(data.error || 'Could not resend the code.'); return; }
      setResendAvailableAt(data.resendAvailableAt);
      setOtp('');
      otpVerifyInFlightRef.current = false;
      otpVerifiedRef.current = false;
      setInfo('A new code has been sent.');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const errors: FieldErrors = {
      newPassword: validateField(passwordSchema, newPassword),
      confirmPassword: confirmPasswordError(newPassword, confirmNewPassword),
    };
    setResetFieldErrors(errors);
    setResetTouched({ newPassword: true, confirmPassword: true });
    if (Object.values(errors).some(Boolean)) return;

    setSubmitting(true);
    try {
      const { ok, data } = await postJson('/api/auth/password/reset', { newPassword, confirmPassword: confirmNewPassword });
      if (!ok) {
        if (!applyServerError(data, setResetFieldErrors, t => setResetTouched(prev => ({ ...prev, ...t })))) {
          setError(data.error || 'Could not reset your password.');
        }
        return;
      }
      setStep('reset-done');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const backToLogin = () => {
    setStep('credentials'); setMode('login'); setError(''); setInfo('');
    setPassword(''); setConfirmPassword(''); setNewPassword(''); setConfirmNewPassword('');
    setOtp(''); setChallengeId(''); setPurpose(null); setChannels(null);
    setFieldErrors({}); setTouched({}); setResetFieldErrors({}); setResetTouched({});
  };

  const shown = (field: string, errors: FieldErrors, touchedMap: Partial<Record<string, boolean>>) => (touchedMap[field] ? errors[field] : undefined);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8FC', padding: '24px', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <BrandHeader />

        {step === 'credentials' && (
          <Card>
            <div style={{ display: 'flex', backgroundColor: '#F1F2F8', borderRadius: 12, padding: 4, marginBottom: 24 }}>
              {(['login', 'signup'] as Mode[]).map(m => (
                <button
                  key={m} type="button" onClick={() => switchMode(m)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
                    fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                    background: mode === m ? '#fff' : 'transparent',
                    color: mode === m ? '#0f1020' : '#64748b',
                    boxShadow: mode === m ? '0 2px 8px rgba(15,23,42,0.08)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {m === 'login' ? 'Login' : 'Sign Up'}
                </button>
              ))}
            </div>

            <form onSubmit={handleCredentialsSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
              {mode === 'signup' && (
                <TextField
                  id="sp-name" label="Full Name" value={name}
                  onChange={v => { setName(v); if (touched.name) setFieldError('name', validateField(nameSchema, v)); }}
                  onBlur={() => blurValidate('name', nameSchema, name)}
                  error={shown('name', fieldErrors, touched)}
                  autoComplete="name" placeholder="Jane Doe"
                />
              )}

              {mode === 'signup' ? (
                <TextField
                  id="sp-email" label="Email" type="email" value={email}
                  onChange={v => { setEmail(v); if (touched.email) setFieldError('email', validateField(emailSchema, v)); }}
                  onBlur={() => blurValidate('email', emailSchema, email)}
                  error={shown('email', fieldErrors, touched)}
                  autoComplete="email" placeholder="you@company.com"
                />
              ) : (
                <TextField
                  id="sp-identifier" label="Email or Mobile Number" value={identifier}
                  onChange={v => { setIdentifier(v); if (touched.identifier) setFieldError('identifier', validateField(loginIdentifierSchema, v)); }}
                  onBlur={() => blurValidate('identifier', loginIdentifierSchema, identifier)}
                  error={shown('identifier', fieldErrors, touched)}
                  autoComplete="username" placeholder="you@company.com or +919876543210"
                />
              )}

              {mode === 'signup' && (
                <TextField
                  id="sp-mobile" label="Mobile Number" type="tel" inputMode="tel" value={mobile}
                  onChange={v => { setMobile(v); if (touched.mobile) setFieldError('mobile', validateField(mobileSchema, v)); }}
                  onBlur={() => blurValidate('mobile', mobileSchema, mobile)}
                  error={shown('mobile', fieldErrors, touched)}
                  autoComplete="tel" placeholder="+919876543210"
                />
              )}

              <PasswordField
                id="sp-password" label="Password" value={password}
                onChange={v => {
                  setPassword(v);
                  if (touched.password) setFieldError('password', validateField(passwordSchema, v));
                  if (touched.confirmPassword) setFieldError('confirmPassword', confirmPasswordError(v, confirmPassword));
                }}
                onBlur={() => blurValidate('password', passwordSchema, password)}
                error={shown('password', fieldErrors, touched)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="At least 8 characters"
                showRequirements={mode === 'signup'}
              />

              {mode === 'signup' && (
                <PasswordField
                  id="sp-confirm-password" label="Confirm Password" value={confirmPassword}
                  onChange={v => { setConfirmPassword(v); if (touched.confirmPassword) setFieldError('confirmPassword', confirmPasswordError(password, v)); }}
                  onBlur={() => { markTouched('confirmPassword'); setFieldError('confirmPassword', confirmPasswordError(password, confirmPassword)); }}
                  error={shown('confirmPassword', fieldErrors, touched)}
                  autoComplete="new-password"
                />
              )}

              {mode === 'login' && (
                <div style={{ textAlign: 'right', marginTop: -8 }}>
                  <button type="button" onClick={() => { setStep('forgot-identifier'); setError(''); setInfo(''); }} style={{ border: 'none', background: 'none', color: '#5b4cf5', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>
                    Forgot Password?
                  </button>
                </div>
              )}

              <ErrorBanner message={error} />

              <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>
                {submitting ? (mode === 'login' ? 'Checking…' : 'Creating account…') : 'Continue'}
              </button>
            </form>

            <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', marginTop: 20 }}>
              {mode === 'login' ? (
                <>Don&apos;t have an account?{' '}
                  <button type="button" onClick={() => switchMode('signup')} style={{ border: 'none', background: 'none', color: '#5b4cf5', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, padding: 0 }}>Sign Up</button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button type="button" onClick={() => switchMode('login')} style={{ border: 'none', background: 'none', color: '#5b4cf5', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, padding: 0 }}>Login</button>
                </>
              )}
            </p>
          </Card>
        )}

        {step === 'forgot-identifier' && (
          <Card>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f1020', margin: '0 0 6px' }}>Reset your password</h1>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px' }}>Enter the email or mobile number on your account and we&apos;ll send a verification code.</p>
            <form onSubmit={handleForgotSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
              <TextField
                id="sp-forgot" label="Email or Mobile Number" value={forgotIdentifier}
                onChange={v => { setForgotIdentifier(v); if (touched.identifier) setFieldError('identifier', v.trim() ? undefined : 'Please enter your email or mobile number.'); }}
                onBlur={() => { markTouched('identifier'); setFieldError('identifier', forgotIdentifier.trim() ? undefined : 'Please enter your email or mobile number.'); }}
                error={shown('identifier', fieldErrors, touched)}
                autoComplete="username" placeholder="you@company.com or +919876543210"
              />
              <ErrorBanner message={error} />
              <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>{submitting ? 'Sending…' : 'Send Code'}</button>
            </form>
            <p style={{ textAlign: 'center', fontSize: 13, marginTop: 20 }}>
              <button type="button" onClick={backToLogin} style={{ border: 'none', background: 'none', color: '#5b4cf5', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, padding: 0 }}>Back to Login</button>
            </p>
          </Card>
        )}

        {step === 'channel-select' && channels && (
          <Card>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f1020', margin: '0 0 6px' }}>Verify your identity</h1>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px' }}>Choose how you want to receive your verification code.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {([
                { channel: 'EMAIL' as const, label: 'Email', destination: channels.email },
                { channel: 'WHATSAPP' as const, label: 'WhatsApp', destination: channels.whatsapp },
              ]).map(opt => (
                <button
                  key={opt.channel}
                  type="button"
                  disabled={!opt.destination || submitting}
                  onClick={() => requestOtp(opt.channel)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    padding: '14px 16px', borderRadius: 12, textAlign: 'left', fontFamily: 'inherit',
                    border: '1px solid #e2e8f0', backgroundColor: '#fff',
                    cursor: opt.destination && !submitting ? 'pointer' : 'not-allowed',
                    opacity: opt.destination ? 1 : 0.5,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f1020' }}>{opt.label}</span>
                  <span style={{ fontSize: 12.5, color: '#64748b' }}>{opt.destination || 'Not available for this account'}</span>
                </button>
              ))}
            </div>

            <ErrorBanner message={error} />
          </Card>
        )}

        {step === 'otp-entry' && (
          <Card>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f1020', margin: '0 0 6px', textAlign: 'center' }}>Enter Verification Code</h1>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px', textAlign: 'center' }}>
              We sent a 6-digit verification code to:<br />
              <strong style={{ color: '#0f1020' }}>{maskedDestination}</strong>
            </p>
            {info && <p style={{ fontSize: 12.5, color: '#16a34a', textAlign: 'center', margin: '0 0 14px' }}>{info}</p>}

            <div style={{ marginBottom: 18 }}>
              <OtpInput value={otp} onChange={handleOtpChange} disabled={submitting} />
            </div>

            <ErrorBanner message={error} />

            <button
              type="button"
              disabled={submitting || otp.length !== 6}
              onClick={() => verifyOtp(otp)}
              style={{ ...primaryButtonStyle(submitting || otp.length !== 6), marginTop: 14 }}
            >
              {submitting ? 'Verifying…' : 'Verify'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              {resendMsLeft > 0 ? (
                <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Resend code in {Math.ceil(resendMsLeft / 1000)}s</span>
              ) : (
                <button type="button" onClick={handleResend} disabled={submitting} style={{ border: 'none', background: 'none', color: '#5b4cf5', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>
                  Resend OTP
                </button>
              )}
            </div>

            <p style={{ textAlign: 'center', fontSize: 13, marginTop: 16 }}>
              <button type="button" onClick={purpose === 'PASSWORD_RESET' ? backToLogin : () => setStep('channel-select')} style={{ border: 'none', background: 'none', color: '#64748b', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>
                {purpose === 'PASSWORD_RESET' ? 'Cancel' : '← Choose a different method'}
              </button>
            </p>
          </Card>
        )}

        {step === 'reset-password' && (
          <Card>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f1020', margin: '0 0 6px' }}>Set a new password</h1>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px' }}>Choose a new password for your account.</p>
            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
              <PasswordField
                id="sp-new-password" label="New Password" value={newPassword}
                onChange={v => {
                  setNewPassword(v);
                  if (resetTouched.newPassword) setResetFieldErrors(prev => ({ ...prev, newPassword: validateField(passwordSchema, v) }));
                  if (resetTouched.confirmPassword) setResetFieldErrors(prev => ({ ...prev, confirmPassword: confirmPasswordError(v, confirmNewPassword) }));
                }}
                onBlur={() => { setResetTouched(t => ({ ...t, newPassword: true })); setResetFieldErrors(prev => ({ ...prev, newPassword: validateField(passwordSchema, newPassword) })); }}
                error={shown('newPassword', resetFieldErrors, resetTouched)}
                autoComplete="new-password" placeholder="At least 8 characters"
                showRequirements
              />
              <PasswordField
                id="sp-confirm-new-password" label="Confirm New Password" value={confirmNewPassword}
                onChange={v => { setConfirmNewPassword(v); if (resetTouched.confirmPassword) setResetFieldErrors(prev => ({ ...prev, confirmPassword: confirmPasswordError(newPassword, v) })); }}
                onBlur={() => { setResetTouched(t => ({ ...t, confirmPassword: true })); setResetFieldErrors(prev => ({ ...prev, confirmPassword: confirmPasswordError(newPassword, confirmNewPassword) })); }}
                error={shown('confirmPassword', resetFieldErrors, resetTouched)}
                autoComplete="new-password"
              />
              <ErrorBanner message={error} />
              <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>{submitting ? 'Saving…' : 'Reset Password'}</button>
            </form>
          </Card>
        )}

        {step === 'reset-done' && (
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
              <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f1020', margin: '0 0 6px' }}>Password updated</h1>
              <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px' }}>Your password has been reset and you&apos;ve been logged out everywhere else. Please log in with your new password.</p>
              <button type="button" onClick={backToLogin} style={primaryButtonStyle(false)}>Back to Login</button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
