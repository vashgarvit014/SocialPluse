import Link from 'next/link';
import { listUsers, countUsersByStatus, type UserStatus } from '@/lib/auth/users';
import { avatarColor, initials, relTime, absDate, badge } from '../ui';

const PAGE_SIZE = 20;
const TABS: { key: UserStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'SUSPENDED', label: 'Suspended' },
];

export default async function SuperadminUsersPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string; page?: string }> }) {
  const { search = '', status: statusParam = 'ALL', page = '1' } = await searchParams;
  const status = (['ACTIVE', 'PENDING', 'SUSPENDED'] as const).includes(statusParam as UserStatus) ? (statusParam as UserStatus) : undefined;
  const pageNum = Math.max(Number(page) || 1, 1);

  const [{ users, total }, counts] = await Promise.all([
    listUsers({ search: search || undefined, status, limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE }),
    countUsersByStatus(),
  ]);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const tabCounts: Record<string, number> = { ALL: counts.total, ACTIVE: counts.active, PENDING: counts.pending, SUSPENDED: counts.suspended };

  const qs = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({ search, status: statusParam, ...overrides });
    if (!p.get('search')) p.delete('search');
    return `?${p.toString()}`;
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TABS.map(t => {
            const active = t.key === statusParam || (t.key === 'ALL' && statusParam === 'ALL');
            return (
              <Link
                key={t.key}
                href={qs({ status: t.key, page: '1' })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${active ? 'var(--ac)' : 'var(--bd)'}`,
                  background: active ? 'var(--acs)' : 'var(--sf)', color: active ? 'var(--act)' : 'var(--tx)',
                  borderRadius: 9, padding: '7px 12px', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
                }}
              >
                {t.label}<span style={{ fontSize: 11, opacity: 0.7 }}>{tabCounts[t.key]}</span>
              </Link>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: 'var(--mu)' }}>View-only — accounts come from public signup, never from here.</span>
      </div>

      <form method="GET" style={{ display: 'flex' }}>
        <input type="hidden" name="status" value={statusParam} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 9, padding: '0 12px', height: 36, flex: '0 1 320px', minWidth: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--mu)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="text" name="search" defaultValue={search} placeholder="Search name, email, or mobile" style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, minWidth: 0, height: 34 }} />
        </label>
      </form>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1000 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.7fr 1.2fr .8fr .9fr .9fr 220px', gap: 12, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
              <span>NAME</span><span>EMAIL</span><span>MOBILE</span><span>STATUS</span><span>LAST LOGIN</span><span>CREATED AT</span><span style={{ textAlign: 'right' }}>ACTIONS</span>
            </div>
            {users.map(u => {
              const st = badge(u.status);
              return (
                <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.7fr 1.2fr .8fr .9fr .9fr 220px', gap: 12, alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--bd)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColor(u.name), color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(u.name)}</span>
                    <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</span>
                  </span>
                  <span style={{ color: 'var(--mu)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                  <span style={{ color: 'var(--mu)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{u.mobile || '—'}</span>
                  <span><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span></span>
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>{relTime(u.lastLoginAt)}</span>
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>{absDate(u.createdAt)}</span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                    <Link href={`/superadmin/users/${u.id}`} style={{ border: '1px solid var(--bd)', background: 'var(--sf)', borderRadius: 7, padding: '5px 10px', fontWeight: 700, fontSize: 12, textDecoration: 'none', color: 'inherit' }}>View</Link>
                  </span>
                </div>
              );
            })}
            {users.length === 0 && (
              <div style={{ padding: 36, textAlign: 'center', color: 'var(--mu)' }}>No users match these filters.</div>
            )}
          </div>
        </div>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <Link
              key={p}
              href={qs({ page: String(p) })}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none',
                color: p === pageNum ? '#fff' : 'var(--tx)', background: p === pageNum ? 'var(--ac)' : 'var(--sf)', border: '1px solid var(--bd)',
              }}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
