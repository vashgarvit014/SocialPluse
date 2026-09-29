import Link from 'next/link';
import { countUsersByStatus, listRecentSignups } from '@/lib/auth/users';
import { listAuthEvents } from '@/lib/auth/audit';
import { getSystemHealth } from '@/lib/auth/system-health';
import { getOpsSummary, listSystemLogs } from '@/lib/system-log-reader';
import { avatarColor, initials, relTime, badge } from './ui';

function StatTile({ label, value, sub, dot, href }: { label: string; value: string | number; sub: string; dot: string; href: string }) {
  return (
    <Link href={href} style={{ textAlign: 'left', textDecoration: 'none', cursor: 'pointer', background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, color: 'inherit' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--mu)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{label}
      </span>
      <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 11.5, color: 'var(--mu)' }}>{sub}</span>
    </Link>
  );
}

function Card({ title, action, children }: { title: string; action?: { label: string; href: string }; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
        {action && <Link href={action.href} style={{ border: 'none', background: 'none', color: 'var(--act)', fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}>{action.label} →</Link>}
      </div>
      {children}
    </div>
  );
}

export default async function SuperadminOverviewPage() {
  const [counts, recentSignups, recentActivity, health, ops, recentOps] = await Promise.all([
    countUsersByStatus(),
    listRecentSignups(6),
    listAuthEvents(6),
    getSystemHealth(),
    getOpsSummary(),
    listSystemLogs({ limit: 8, offset: 0 }),
  ]);

  const healthIssues = health.filter(h => h.status !== 'OK').length;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em' }}>Superadmin Overview</div>
        <div style={{ fontSize: 12.5, color: 'var(--mu)' }}>Monitor SocialPulse activity and platform health.</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--mu)' }}>ACCOUNTS</div>
        <div className="sa-dash-tiles">
          <StatTile label="Total Users" value={counts.total} sub="All accounts" dot="var(--ac)" href="/superadmin/users" />
          <StatTile label="Active" value={counts.active} sub="Can sign in" dot="var(--ok)" href="/superadmin/users" />
          <StatTile label="Pending" value={counts.pending} sub="Awaiting verification" dot="var(--warn)" href="/superadmin/users" />
          <StatTile label="Suspended" value={counts.suspended} sub="Login blocked" dot="var(--bad)" href="/superadmin/users" />
        </div>
      </div>

      <div className="sa-dash-grid">
        <div className="sa-dash-col">
          <Card title="Recent signups" action={{ label: 'All users', href: '/superadmin/users' }}>
          {recentSignups.length === 0 && <div style={{ padding: '20px 0', color: 'var(--mu)' }}>No users yet.</div>}
          {recentSignups.map(u => {
            const st = badge(u.status);
            return (
              <Link key={u.id} href={`/superadmin/users/${u.id}`} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--bd)', textDecoration: 'none', color: 'inherit' }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(u.name), color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(u.name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700 }}>{u.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--mu)', whiteSpace: 'nowrap' }}>{relTime(u.createdAt)}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
              </Link>
            );
          })}
        </Card>

        <Card title="Recent login activity" action={{ label: 'Auth activity', href: '/superadmin/auth-activity' }}>
          {recentActivity.length === 0 && <div style={{ padding: '20px 0', color: 'var(--mu)' }}>No activity yet.</div>}
          {recentActivity.map(e => {
            const res = badge('SUCCESS');
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--bd)' }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(e.event), color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(e.event.replace(/_/g, ' '))}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{e.event.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 12, color: 'var(--mu)' }}>{e.channel || '—'} · {relTime(e.createdAt)}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: res.bg, color: res.fg }}>Event</span>
              </div>
            );
          })}
        </Card>

        <Card title="Recent activity" action={{ label: 'View all logs', href: '/superadmin/logs' }}>
          {recentOps.rows.length === 0 && <div style={{ padding: '20px 0', color: 'var(--mu)' }}>No activity yet — events appear here as the app runs.</div>}
          {recentOps.rows.slice(0, 8).map(e => {
            const tone = e.level === 'ERROR' ? badge('ERROR') : e.level === 'SUCCESS' ? badge('ACTIVE') : e.level === 'WARN' ? badge('PENDING') : badge('x');
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--bd)' }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(e.event), color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(e.event.replace(/_/g, ' '))}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.event.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 12, color: 'var(--mu)' }}>{e.category}{e.platform ? ` · ${e.platform}` : ''}{e.userEmail ? ` · ${e.userEmail}` : ''} · {relTime(e.createdAt)}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: tone.bg, color: tone.fg }}>{e.level}</span>
              </div>
            );
          })}
        </Card>

        </div>
        <div className="sa-dash-col">
        <Card title="Operations today" action={{ label: 'View all logs', href: '/superadmin/logs' }}>
          <div className="sa-ops-grid">
            {[
              { label: 'Errors', value: ops.errorsToday, bad: ops.errorsToday > 0 },
              { label: 'Failed logins', value: ops.failedLoginsToday, bad: ops.failedLoginsToday > 0 },
              { label: 'Failed OTPs', value: ops.failedOtpsToday, bad: ops.failedOtpsToday > 0 },
              { label: 'Failed AI', value: ops.failedAiToday, bad: ops.failedAiToday > 0 },
              { label: 'Failed publishes', value: ops.failedPublicationsToday, bad: ops.failedPublicationsToday > 0 },
            ].map(s => (
              <div key={s.label} style={{ borderRadius: 9, background: 'var(--sf2)', padding: '9px 10px' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.bad ? 'var(--bad)' : 'var(--ok)' }}>{s.value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--mu)', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="System health" action={{ label: 'Details', href: '/superadmin/system-health' }}>
          <div style={{ fontSize: 13, color: healthIssues === 0 ? 'var(--ok)' : 'var(--warn)', fontWeight: 700, marginBottom: 10 }}>
            {healthIssues === 0 ? 'All systems configured' : `${healthIssues} item(s) need attention`}
          </div>
          <div className="sa-health-grid">
            {health.map(h => {
              const st = badge(h.status);
              return (
                <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 9, background: 'var(--sf2)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.fg, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span>
                </div>
              );
            })}
          </div>
        </Card>
        </div>
      </div>
    </>
  );
}
