import { headers } from 'next/headers';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { requireSuperadmin } from '@/lib/auth/roles';
import { callAdminService } from '@/lib/admin-client';
import SuperadminShell from './shell';
import './theme.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sa-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-sa-mono', display: 'swap' });

// Phase 12 cleanup: this layout used to call countUsersByStatus(),
// getSystemHealth(), getPublishingCounts(), unreadCount(), and a direct
// `queryOne` for the flagged-user count — five separate direct Postgres
// reads inside the "frontend" container, on every Superadmin navigation.
// Now a single call to admin-service's GET /dashboard/summary, which
// aggregates all of it server-side. If admin-service is unavailable, the
// shell still renders with zero badge counts rather than crashing the
// entire Superadmin console on every page load.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') || '';
  if (pathname === '/superadmin/login') {
    return (
      <div className={`${sans.variable} ${mono.variable}`} style={{ fontFamily: 'var(--font-sa-sans), system-ui, sans-serif', background: '#0d0f2b', color: '#aeb0d4', minHeight: '100vh' }}>
        {children}
      </div>
    );
  }
  const { user } = await requireSuperadmin();

  const summary = await callAdminService<{
    counts: { pending: number };
    flaggedUsers: number;
    healthIssues: number;
    failedPublishing: number;
    unreadNotifications: number;
  }>('/dashboard/summary');
  const badges = summary.ok
    ? summary.data
    : { counts: { pending: 0 }, flaggedUsers: 0, healthIssues: 0, failedPublishing: 0, unreadNotifications: 0 };

  return (
    <div className={`${sans.variable} ${mono.variable}`} style={{ fontFamily: 'var(--font-sa-sans), system-ui, sans-serif' }}>
      <SuperadminShell
        name={user.name} email={user.email} pendingUsers={badges.counts.pending}
        healthIssues={badges.healthIssues} failedPublishing={badges.failedPublishing}
        flaggedUsers={badges.flaggedUsers} unreadNotifications={badges.unreadNotifications}
      >
        {children}
      </SuperadminShell>
    </div>
  );
}
