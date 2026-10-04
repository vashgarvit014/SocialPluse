import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { requireSuperadminSession } from '@/lib/session';
import { callAdminService } from '@/lib/admin-client';
import SuperadminShell from './shell';
import './theme.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sa-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-sa-mono', display: 'swap' });

// This app's real gate: requireSuperadminSession() calls auth-service
// over HTTP (see src/lib/session.ts) — never a direct DB read. The
// dashboard badge counts come from admin-service's GET /dashboard/summary
// (same as apps/web's copy of this layout since Phase 12); the viewer's
// own name/email come from admin-service's GET /users/:id (user-service,
// via admin-service) since auth-service's session payload only carries
// userId/role/accountStatus, not profile fields.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') || '';
  if (pathname === '/superadmin/login') {
    return (
      <div className={`${sans.variable} ${mono.variable}`} style={{ fontFamily: 'var(--font-sa-sans), system-ui, sans-serif', background: '#0d0f2b', color: '#aeb0d4', minHeight: '100vh' }}>
        {children}
      </div>
    );
  }
  const session = await requireSuperadminSession();
  if ('redirect' in session) redirect('/superadmin/login');

  const [profile, summary] = await Promise.all([
    callAdminService<{ user: { name: string; email: string } }>(`/users/${session.userId}`),
    callAdminService<{
      counts: { pending: number };
      flaggedUsers: number;
      healthIssues: number;
      failedPublishing: number;
      unreadNotifications: number;
    }>('/dashboard/summary'),
  ]);
  const name = profile.ok ? profile.data.user.name : 'Superadmin';
  const email = profile.ok ? profile.data.user.email : '';
  const badges = summary.ok
    ? summary.data
    : { counts: { pending: 0 }, flaggedUsers: 0, healthIssues: 0, failedPublishing: 0, unreadNotifications: 0 };

  return (
    <div className={`${sans.variable} ${mono.variable}`} style={{ fontFamily: 'var(--font-sa-sans), system-ui, sans-serif' }}>
      <SuperadminShell
        name={name} email={email} pendingUsers={badges.counts.pending}
        healthIssues={badges.healthIssues} failedPublishing={badges.failedPublishing}
        flaggedUsers={badges.flaggedUsers} unreadNotifications={badges.unreadNotifications}
      >
        {children}
      </SuperadminShell>
    </div>
  );
}
