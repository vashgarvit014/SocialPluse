import { relTime, badge } from '../ui';
import { callAdminService as callAdminGateway } from '@/lib/admin-client';

export const dynamic = 'force-dynamic';

// Phase 11 cleanup: this page used to run its cross-user moderation query
// directly against Postgres from inside the monolith's SSR render — now
// reads from admin-service, which proxies to user-service's
// GET /internal/moderation/queue (the exact same SQL, moved to the service
// that owns `users`'/moderation columns and `moderation_events`).
const FLAG_REASON = 'REPEATED_PROHIBITED_SEXUAL_CONTENT';
function severityForCount(count: number): 'WARNING' | 'HIGH' | 'CRITICAL' {
  if (count >= 5) return 'CRITICAL';
  if (count >= 3) return 'HIGH';
  return 'WARNING';
}

interface ModeratedUser {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  moderation_violation_count: number;
  moderation_flagged: boolean;
  moderation_flag_reason: string | null;
  moderation_flagged_at: string | null;
  moderation_first_violation_at: string | null;
  moderation_last_violation_at: string | null;
  latest_decision: string | null;
  latest_method: string | null;
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mu)', letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: tone || 'var(--act)' }}>{value}</div>
    </div>
  );
}

/**
 * Moderation queue.
 *
 * The counters come straight from the denormalised columns on `users` (and
 * from moderation_events), so this is a Superadmin-only cross-user view by
 * design — no user-facing route reaches it.
 */
async function callAdminService(path: string): Promise<Record<string, unknown> | null> {
  const res = await callAdminGateway(path);
  return res.ok ? (res.data as Record<string, unknown>) : null;
}

export default async function SuperadminModerationPage() {
  const data = await callAdminService('/moderation/queue');
  if (!data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>Moderation data is temporarily unavailable. Please try again shortly.</div>;
  }
  const users = (data?.users || []) as ModeratedUser[];
  const warningsToday = Number(data?.warningsToday || 0);

  const flagged = users.filter(u => u.moderation_flagged);
  const repeat = users.filter(u => Number(u.moderation_violation_count) >= 2);
  const suspended = users.filter(u => u.status === 'SUSPENDED');

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <a href="/superadmin/moderation/violations" style={{ fontSize: 12.5, fontWeight: 700, color: '#6b5cf6', textDecoration: 'none' }}>View all violations (uploads, AI generation, publishing) →</a>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatTile label="Flagged Accounts" value={flagged.length} tone={flagged.length ? '#c0352c' : undefined} />
        <StatTile label="Warnings Today" value={warningsToday} />
        <StatTile label="Repeat Violations" value={repeat.length} tone={repeat.length ? '#c0352c' : undefined} />
        <StatTile label="Suspended Accounts" value={suspended.length} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 11, background: 'var(--acs)', color: 'var(--act)', fontSize: 13, fontWeight: 600, lineHeight: 1.5, marginBottom: 14 }}>
        Moderation escalates on CONFIRMED prohibited nudity or explicit-content requests only. Classification errors are reversible —
        use “Clear flag” on a user detail page. Accounts are never suspended automatically.
      </div>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        {users.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 13 }}>
            No moderation activity yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--sf2)' }}>
                {['User', 'Email', 'Violations', 'Reason', 'Last Violation', 'Status', 'Flag', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const count = Number(u.moderation_violation_count || 0);
                const sev = severityForCount(count);
                const st = badge(u.status === 'ACTIVE' ? 'ACTIVE' : u.status === 'PENDING' ? 'PENDING' : 'SUSPENDED');
                const flagTone = u.moderation_flagged ? badge('SUSPENDED') : badge('PENDING');
                return (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--bd)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 700 }}>{u.name}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--mu)' }}>{u.email}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontWeight: 800, color: count >= 3 ? '#c0352c' : count > 0 ? '#b7791f' : 'var(--mu)' }}>{count}</span>
                      {count > 0 && <div style={{ fontSize: 10.5, color: 'var(--mu)', fontWeight: 700 }}>{sev}</div>}
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--mu)', maxWidth: 220, fontSize: 12 }}>
                      {u.moderation_flag_reason || (u.latest_decision && u.latest_decision !== 'ALLOW' ? u.latest_decision.replace(/_/g, ' ') : '—')}
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--mu)', whiteSpace: 'nowrap' }}>{relTime(u.moderation_last_violation_at)}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg }}>{u.status}</span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: flagTone.bg, color: flagTone.fg }}>
                        {u.moderation_flagged ? 'FLAGGED' : 'CLEAR'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* Review + reverse the decision. A flag must never be a dead end. */}
                      <a
                        href={`/superadmin/users/${u.id}`}
                        style={{ fontSize: 11.5, fontWeight: 800, color: '#6b5cf6', textDecoration: 'none', marginRight: 12 }}
                      >
                        Review
                      </a>
                      {u.moderation_flagged && (
                        <span style={{ fontSize: 11, color: 'var(--mu)' }} title={FLAG_REASON}>flagged {relTime(u.moderation_flagged_at)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
