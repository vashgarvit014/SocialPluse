import { headers } from 'next/headers';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { requireSuperadmin } from '@/lib/auth/roles';
import { countUsersByStatus } from '@/lib/auth/users';
import { getSystemHealth } from '@/lib/auth/system-health';
import { getPublishingCounts } from '@/lib/publishing-monitor';
import SuperadminShell from './shell';
import './theme.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sa-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-sa-mono', display: 'swap' });

// The one real gate: requireSuperadmin() does a fresh DB read of the
// signed-in user's role and redirects (never renders past this line) if
// they're unauthenticated or not SUPERADMIN. proxy.ts's cookie check is
// only an optimistic pre-filter — this is what actually enforces the
// boundary, same split documented in proxy.ts's header comment.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  // The two separate-auth pages render bare (no gate, no sidebar shell) —
  // the pathname arrives via the x-pathname header proxy.ts sets, never
  // from client input. Everything else still hits requireSuperadmin().
  const pathname = (await headers()).get('x-pathname') || '';
  if (pathname === '/superadmin/login') {
    return (
      <div className={`${sans.variable} ${mono.variable}`} style={{ fontFamily: 'var(--font-sa-sans), system-ui, sans-serif', background: '#0d0f2b', color: '#aeb0d4', minHeight: '100vh' }}>
        {children}
      </div>
    );
  }
  const { user } = await requireSuperadmin();

  // Nav badge counts — cheap (a COUNT query, the already-cheap health check,
  // and a JSON file read — all already used elsewhere) so computing them on
  // every navigation is fine; nothing here calls an external provider API.
  const [counts, health, publishing] = await Promise.all([countUsersByStatus(), getSystemHealth(), getPublishingCounts()]);
  const healthIssues = health.filter(h => h.status !== 'OK').length;

  return (
    <div className={`${sans.variable} ${mono.variable}`} style={{ fontFamily: 'var(--font-sa-sans), system-ui, sans-serif' }}>
      <SuperadminShell name={user.name} email={user.email} pendingUsers={counts.pending} healthIssues={healthIssues} failedPublishing={publishing.failed}>
        {children}
      </SuperadminShell>
    </div>
  );
}
