'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { listUsers } from '@/lib/auth/users';
import { useSearchParams } from 'next/navigation';
import { avatarColor, initials, absDate } from '@/app/superadmin/ui';

type FieldErrors = Partial<Record<'email' | 'name', string>>;

function validateEmail(email: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email || !email.includes('@')) {
    errors.email = 'A valid email address is required';
  }
  return errors;
}

interface CollabInviteFormProps {
  targetEmail: string;
  targetName: string;
  setTargetEmail: (v: string) => void;
  setTargetName: (v: string) => void;
  onSubmitSuccess: (message: string) => void;
}

function CollabInviteForm({ targetEmail, targetName, setTargetEmail, setTargetName, onSubmitSuccess }: CollabInviteFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalErrors(validateEmail(targetEmail));
    if (Object.keys(localErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/superadmin/collab-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail, targetName, message: 'You are invited to collaborate on SocialPulse!' }),
      });
      const data = await res.json();
      if (!res.ok) {
        onSubmitSuccess(data.error || 'Could not send collab invite.');
        return;
      }
      onSubmitSuccess(`Collab invite sent to ${targetEmail}! The invited user will receive an OTP to activate their account.`);
      setTargetEmail(''); setTargetName(''); setLocalErrors({});
      router.push('/superadmin/collab-invites');
      router.refresh();
    } catch {
      onSubmitSuccess('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 500 }}>
      <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="targetEmail" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>Target Email</label>
        <input
          id="targetEmail"
          value={targetEmail}
          placeholder="recipient@example.com"
          onChange={e => setTargetEmail(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 9, border: `1px solid var(--bd)`, background: 'var(--sf)', color: 'var(--tx)', fontSize: 13, outline: 'none' }}
        />
      </div>
      <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="targetName" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>Target Name (optional)</label>
        <input
          id="targetName"
          value={targetName}
          placeholder="John Doe"
          onChange={e => setTargetName(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 9, border: `1px var(--bd)`, background: 'var(--sf)', color: 'var(--tx)', fontSize: 13, outline: 'none' }}
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        style={{
          width: '100%', padding: '12px 16px', borderRadius: 9, border: 'none',
          fontSize: 13, fontWeight: 700, color: '#fff',
          cursor: submitting ? 'default' : 'pointer',
          opacity: submitting ? 0.7 : 1,
          background: 'linear-gradient(135deg, var(--ac), var(--act))',
        }}
      >
        {submitting ? 'Sending…' : 'Send Collab Invite'}
      </button>
    </form>
  );
}

export default function CollabInvitesPage() {
  const [targetEmail, setTargetEmail] = useState('');
  const [targetName, setTargetName] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const savedQuery = searchParams.get('q') || '';
  const [banner, setBanner] = useState('');

  // Fetch users for search when query changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetchUsers = async () => {
      try {
        const q = savedQuery || searchQuery;
        const res = await fetch(`/api/superadmin/collab-invites?query=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!cancelled) {
          setUsers(data.users);
          setTotal(data.total);
        }
      } catch {
        if (!cancelled) setUsers([]);
        if (!cancelled) setTotal(0);
      }
      if (!cancelled) setLoading(false);
    };
    fetchUsers();
    return () => { cancelled = true; };
  }, [savedQuery, searchQuery]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setPage(1);
    router.push(`/superadmin/collab-invites?q=${encodeURIComponent(value)}`);
  };

  const handleInvite = (user: any) => {
    setTargetEmail(user.email);
    setTargetName(user.name);
  };

  const handleSubmitSuccess = (message: string) => {
    setBanner(message);
    // Auto-clear banner after 5 seconds
    const timer = setTimeout(() => setBanner(''), 5000);
    // Banner is cleared automatically after timeout
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx)', marginBottom: 16 }}>Collab Invites</h1>

      {/* Search and Invite Form Section */}
      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input
            type="text"
            placeholder="Search users by name, email, or mobile..."
            value={searchQuery || savedQuery}
            onChange={handleSearch}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--sf)', color: 'var(--tx)', fontSize: 13, outline: 'none' }}
          />
        </div>

        <CollabInviteForm
          targetEmail={targetEmail}
          targetName={targetName}
          setTargetEmail={setTargetEmail}
          setTargetName={setTargetName}
          onSubmitSuccess={handleSubmitSuccess}
        />
      </div>

      {/* Users Search Results */}
      {loading && <p style={{ textAlign: 'center', color: 'var(--mu)' }}>Loading users…</p>}

      {total > 0 && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 1050 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.7fr 1.2fr .8fr .9fr .9fr 220px', gap: 12, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
                <span>NAME</span><span>EMAIL</span><span>MOBILE</span><span>STATUS</span><span>CREATED AT</span><span style={{ textAlign: 'right' }}>ACTIONS</span>
              </div>
              {users.map(u => {
                const status = u.status || 'UNKNOWN';
                const st = { label: status, bg: status === 'ACTIVE' ? 'var(--ac)' : status === 'PENDING' ? 'var(--wa)' : 'var(--bad)', fg: '#fff' };
                return (
                  <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.7fr 1.2fr .8fr .9fr .9fr 220px', gap: 12, alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--bd)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColor(u.name), color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(u.name)}</span>
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</span>
                    </span>
                    <span style={{ color: 'var(--mu)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                    <span style={{ color: 'var(--mu)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{u.mobile || '—'}</span>
                    <span><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span></span>
                    <span style={{ fontSize: 13, color: 'var(--mu)' }}>{absDate(u.createdAt)}</span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        onClick={() => handleInvite(u)}
                        style={{
                          padding: '6px 12px', borderRadius: 7, border: '1px solid var(--ac)', background: 'var(--ac)', fontWeight: 700, fontSize: 11, textDecoration: 'none', color: '#fff',
                        }}
                        title="Invite this user to collaborate"
                      >
                        Invite
                      </button>
                    </span>
                  </div>
                );
              })}
              {users.length === 0 && (
                <div style={{ padding: 36, textAlign: 'center', color: 'var(--mu)' }}>No users match the search criteria.</div>
              )}
            </div>
          </div>
        </div>
      )} else if (!(searchQuery || savedQuery)) {
        <p style={{ textAlign: 'center', color: 'var(--mu)' }}>No users found. Start typing to search for accounts to invite.</p>
      }

      {/* Banner message */}
      {banner && (
        <div style={{ background: 'var(--oks)', color: 'var(--ok)', padding: '10px 14px', borderRadius: 9, fontSize: 13, marginBottom: 20 }}>
          {banner}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {Array.from({ length: Math.ceil(total / 20) }, (_, i) => i + 1).map(pg => (
            <button
              key={pg}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                textDecoration: 'none',
                color: pg === page ? '#fff' : 'var(--tx)',
                background: pg === page ? 'var(--ac)' : 'var(--sf)', border: '1px solid var(--bd)',
              }}
              onClick={() => setPage(pg)}
            >
              {pg}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}