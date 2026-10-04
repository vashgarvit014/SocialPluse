import { notFound } from 'next/navigation';
import Link from 'next/link';
import { avatarColor, initials, absTime, relTime, badge } from '../../ui';
import UserActions from './user-actions';
import ModerationPanel from './moderation-panel';
import { callAdminService as callAdminGateway } from '@/lib/admin-client';

// Phase 11 cleanup: this page used to call findUserById/listAuthEventsForUser/
// getUserModerationSummary/queryOne directly against Postgres from inside
// the monolith's SSR render — real backend business logic (user-service's
// and auth-service's domains) executing in the "frontend" container. It now
// reads from admin-service, which proxies to user-service for profile/
// moderation and reads auth_audit_logs directly for the auth-activity panel
// (same precedent as admin-service's own /audit-logs route). Never fetches
// or displays password_hash/otp/session token/SMTP/Meta credentials — none
// of these DTOs carry those fields to begin with.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function callAdminService(path: string) {
  const res = await callAdminGateway(path);
  if (!res.ok) return { ok: false as const, status: res.status };
  return { ok: true as const, data: res.data as Record<string, unknown> };
}

export default async function SuperadminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const userResult = await callAdminService(`/users/${id}`);
  if (!userResult.ok) {
    if (userResult.status === 404) notFound();
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>User data is temporarily unavailable. Please try again shortly.</div>;
  }
  const userData = userResult.data;
  if (!userData?.user) notFound();
  const user = userData.user as {
    id: string; name: string; email: string; mobile: string | null; role: string; status: string;
    emailVerifiedAt: string | null; mobileVerifiedAt: string | null; lastLoginAt: string | null;
    mustSetPassword: boolean; createdAt: string;
  };

  const [moderationResult, authEventsResult] = await Promise.all([
    callAdminService(`/moderation/users/${id}`),
    callAdminService(`/users/${id}/auth-events?limit=8`),
  ]);
  const modSummary = (moderationResult.ok ? moderationResult.data?.moderation : undefined) as {
    violationCount: number; flagged: boolean; flagReason: string | null; flaggedAt: string | null;
    firstViolationAt: string | null; lastViolationAt: string | null; latestDecision: string | null;
    latestMethod: string | null; latestEventAt: string | null; severity: 'WARNING' | 'HIGH' | 'CRITICAL';
  } | undefined;
  // Only render the panel when there is something to show, so a clean
  // account detail page stays uncluttered — same condition the original
  // EXISTS() query expressed, now read off the already-fetched summary
  // instead of a second query.
  const hasModerationActivity = !!modSummary && (modSummary.violationCount > 0 || modSummary.flagged || !!modSummary.latestEventAt);
  const moderation = hasModerationActivity ? modSummary! : null;
  const authEvents = (authEventsResult.ok ? authEventsResult.data?.events : []) as { id: string; event: string; channel: string | null; createdAt: string }[] || [];

  const st = badge(user.status);
  const ev = badge(user.emailVerifiedAt ? 'ACTIVE' : 'PENDING');
  const mv = badge(user.mobileVerifiedAt ? 'ACTIVE' : 'PENDING');

  const facts: [string, string][] = [
    ['Email', user.email],
    ['Mobile', user.mobile || '—'],
    ['Role', user.role],
    ['Created At', absTime(user.createdAt)],
    ['Last Login', user.lastLoginAt ? absTime(user.lastLoginAt) : 'Never'],
    ['Must Set Password', user.mustSetPassword ? 'Yes (created by admin, not yet set)' : 'No'],
  ];

  return (
    <>
      <Link href="/superadmin/users" style={{ alignSelf: 'flex-start', border: 'none', background: 'none', color: 'var(--act)', fontWeight: 700, textDecoration: 'none' }}>← All users</Link>

      <ModerationPanel userId={user.id} summary={moderation} />

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ width: 52, height: 52, borderRadius: '50%', background: avatarColor(user.name), color: '#fff', fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(user.name)}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>{user.name}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
            {user.role === 'SUPERADMIN' && <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'var(--acs)', color: 'var(--act)' }}>SUPERADMIN</span>}
          </div>
          <div style={{ color: 'var(--mu)', marginTop: 3 }}>{user.email} · {user.mobile || 'No mobile on file'}</div>
        </div>
        {user.role !== 'SUPERADMIN' && <UserActions userId={user.id} status={user.status as 'ACTIVE' | 'SUSPENDED'} />}
      </div>

      {user.role === 'SUPERADMIN' ? (
        <div style={{ fontSize: 12.5, color: 'var(--mu)' }}>Superadmin accounts cannot be modified from this screen.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
          <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '6px 18px 10px' }}>
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--bd)' }}>
                <span style={{ width: 150, flexShrink: 0, color: 'var(--mu)', fontWeight: 600, fontSize: 13 }}>{k}</span>
                <span style={{ fontWeight: 600, minWidth: 0, wordBreak: 'break-word' }}>{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--bd)', alignItems: 'center' }}>
              <span style={{ width: 150, flexShrink: 0, color: 'var(--mu)', fontWeight: 600, fontSize: 13 }}>Email Verified</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: ev.bg, color: ev.fg }}>{user.emailVerifiedAt ? 'Yes' : 'No'}</span>
            </div>
            <div style={{ display: 'flex', gap: 14, padding: '11px 0', alignItems: 'center' }}>
              <span style={{ width: 150, flexShrink: 0, color: 'var(--mu)', fontWeight: 600, fontSize: 13 }}>Mobile Verified</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: mv.bg, color: mv.fg }}>{user.mobileVerifiedAt ? 'Yes' : 'No'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '10px 12px', borderRadius: 9, background: 'var(--sf2)', fontSize: 12, color: 'var(--mu)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              Passwords, OTPs and session tokens are never shown.
            </div>
          </div>

          <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '14px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Recent auth activity</div>
            {authEvents.map(e => {
              const res = badge(/FAILED/.test(e.event) ? 'FAILED' : 'SUCCESS');
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--bd)' }}>
                  <span style={{ fontFamily: 'var(--font-sa-mono), monospace', fontSize: 12, flex: 1, minWidth: 0 }}>{e.event}</span>
                  <span style={{ fontSize: 12, color: 'var(--mu)', width: 74 }}>{e.channel || '—'}</span>
                  <span style={{ fontSize: 12, color: 'var(--mu)', width: 70, textAlign: 'right' }}>{relTime(e.createdAt)}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: res.bg, color: res.fg, width: 68, textAlign: 'center' }}>{res.label}</span>
                </div>
              );
            })}
            {authEvents.length === 0 && <div style={{ padding: '10px 0', color: 'var(--mu)', borderTop: '1px solid var(--bd)' }}>No auth events recorded.</div>}
          </div>
        </div>
      )}
    </>
  );
}
