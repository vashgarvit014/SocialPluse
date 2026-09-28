'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { nameSchema, emailSchema, mobileSchema } from '@/lib/auth/schemas';

type FieldErrors = Partial<Record<'name' | 'email' | 'mobile', string>>;

function validate(name: string, email: string, mobile: string): FieldErrors {
  const errors: FieldErrors = {};
  const n = nameSchema.safeParse(name);
  if (!n.success) errors.name = n.error.issues[0]?.message;
  const e = emailSchema.safeParse(email);
  if (!e.success) errors.email = e.error.issues[0]?.message;
  const m = mobileSchema.safeParse(mobile);
  if (!m.success) errors.mobile = m.error.issues[0]?.message;
  return errors;
}

function Field({ id, label, value, onChange, error, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        style={{ width: '100%', padding: '10px 14px', borderRadius: 9, border: `1px solid ${error ? 'var(--bad)' : 'var(--bd)'}`, background: 'var(--sf)', color: 'var(--tx)', fontSize: 13, outline: 'none' }}
      />
      {error && <div id={`${id}-error`} style={{ fontSize: 12, color: 'var(--bad)', marginTop: 5 }}>{error}</div>}
    </div>
  );
}

export default function CreateSuperadminUserPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<'name' | 'email' | 'mobile', boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState('');
  const [success, setSuccess] = useState('');

  const liveErrors = validate(name, email, mobile);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, mobile: true });
    if (Object.keys(liveErrors).length > 0) { setErrors(liveErrors); return; }

    setSubmitting(true);
    setBanner('');
    try {
      const res = await fetch('/api/superadmin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, mobile }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fields) setErrors(data.fields);
        else setBanner(data.error || 'Could not create the user.');
        return;
      }
      setSuccess(`${data.user.name} was created as a PENDING user. Tell them to use "Forgot Password" on the login page with their email or mobile to set a password and activate their account.`);
      setName(''); setEmail(''); setMobile(''); setTouched({});
    } catch {
      setBanner('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <Link href="/superadmin/users" style={{ fontSize: 12, color: 'var(--act)', fontWeight: 700, textDecoration: 'none' }}>← Back to Users</Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx)', margin: '10px 0 4px' }}>Create User</h1>
      <p style={{ fontSize: 13, color: 'var(--mu)', margin: '0 0 22px' }}>
        Creates a normal USER account (PENDING until they verify). Superadmin accounts cannot be created here.
      </p>

      {banner && <div style={{ background: 'var(--bads)', color: 'var(--bad)', padding: '10px 14px', borderRadius: 9, fontSize: 13, marginBottom: 16 }}>{banner}</div>}
      {success && <div style={{ background: 'var(--oks)', color: 'var(--ok)', padding: '10px 14px', borderRadius: 9, fontSize: 13, marginBottom: 16 }}>{success}</div>}

      <form onSubmit={handleSubmit} noValidate>
        <Field id="name" label="Full Name" value={name} onChange={setName} error={touched.name ? errors.name || liveErrors.name : undefined} placeholder="Jane Doe" />
        <Field id="email" label="Email" value={email} onChange={setEmail} error={touched.email ? errors.email || liveErrors.email : undefined} placeholder="jane@example.com" />
        <Field id="mobile" label="Mobile" value={mobile} onChange={setMobile} error={touched.mobile ? errors.mobile || liveErrors.mobile : undefined} placeholder="+919876543210" />

        <button
          type="submit"
          disabled={submitting}
          style={{ padding: '11px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 700, color: '#fff', cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1, background: 'linear-gradient(135deg, var(--ac), var(--act))' }}
        >
          {submitting ? 'Creating…' : 'Create User'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/superadmin/users')}
          style={{ marginLeft: 10, padding: '11px 18px', borderRadius: 9, border: '1px solid var(--bd)', fontSize: 13, fontWeight: 700, color: 'var(--mu)', background: 'var(--sf)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
