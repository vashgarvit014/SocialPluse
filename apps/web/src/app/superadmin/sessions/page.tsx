import { callAdminService } from '@/lib/admin-client';
import { getSession } from '@/lib/auth/session';
import { avatarColor, initials, absTime, relTime } from '../ui';
import TerminateButton from './terminate-button';

interface ActiveSession { id: string; userId: string; userName: string; userEmail: string; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string }

// Phase 12 cleanup: this page used to call listActiveSessions()/
// countActiveSessions() directly against Postgres (user_sessions, an
// auth-service-owned table). Now reads from admin-service. getSession()
// (the viewer's OWN session cookie, to mark "This session" in the table)
// stays — that only decrypts the current request's own cookie in memory,
// no DB/table access, same as every page's requireSuperadmin() gate.
export default async function SuperadminSessionsPage() {
  const [result, current] = await Promise.all([
    callAdminService<{ sessions: ActiveSession[]; total: number }>('/sessions?limit=100'),
    getSession(),
  ]);
  if (!result.ok) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>Session data is temporarily unavailable. Please try again shortly.</div>;
  }
  const { sessions, total } = result.data;
  const uniqueUsers = new Set(sessions.map(s => s.userId)).size;

  return (
    <>
      <div style={{ padding: '11px 14px', borderRadius: 11, background: 'var(--acs)', color: 'var(--act)', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
        This page lists sessions created since session tracking was added — logins from before that are still valid (grandfathered) but won&apos;t appear here. An ACTIVE account status does not mean the user is currently logged in.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mu)' }}>Active Sessions</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4 }}>{total}</div>
        </div>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mu)' }}>Unique Users</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4 }}>{uniqueUsers}</div>
        </div>
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 980 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.6fr 1fr 1fr 1.3fr 110px', gap: 12, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
              <span>USER</span><span>EMAIL</span><span>LOGIN TIME</span><span>LAST ACTIVITY</span><span>DEVICE / BROWSER</span><span style={{ textAlign: 'right' }}>ACTION</span>
            </div>
            {sessions.map(s => {
              const isCurrent = current?.sessionId === s.id;
              return (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.6fr 1fr 1fr 1.3fr 110px', gap: 12, alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--bd)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColor(s.userName), color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(s.userName)}</span>
                    <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.userName}</span>
                  </span>
                  <span style={{ color: 'var(--mu)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.userEmail}</span>
                  <span style={{ fontSize: 13 }}>{absTime(s.createdAt)}</span>
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>{relTime(s.lastSeenAt)}</span>
                  <span style={{ fontSize: 13, color: 'var(--mu)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.userAgent || '—'}</span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {isCurrent ? <span style={{ fontSize: 12, color: 'var(--mu)' }}>This session</span> : <TerminateButton sessionId={s.id} />}
                  </span>
                </div>
              );
            })}
            {sessions.length === 0 && <div style={{ padding: 36, textAlign: 'center', color: 'var(--mu)' }}>Nobody is logged in right now.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
