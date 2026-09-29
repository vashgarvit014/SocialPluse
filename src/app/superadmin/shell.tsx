'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { initials, avatarColor } from './ui';

// Icon paths + palette match the approved design reference (a Claude
// workshop artifact the design was reviewed in) — reproduced here as plain
// SVG path data, not copied wholesale (that artifact runs on its own
// component runtime, not React/Next.js — see conversation history).
const ICONS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1.5a4 4 0 0 0-3-3.9M16 3.6a3.5 3.5 0 0 1 0 6.8',
  sessions: 'M3 5h18v11H3zM8 20h8M12 16v4',
  connections: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  health: 'M3 12h4l3-7 4 14 3-7h4',
  publishing: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  auth: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9.5 12l2 2 3.5-3.5',
  ai: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  audit: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

type NavItem = { id: string; href: string; label: string; icon: string; badge?: number; badgeColor?: string };
type NavGroup = { label: string; items: NavItem[] };

function buildGroups(pendingUsers: number, healthIssues: number, failedPublishing: number): NavGroup[] {
  return [
    { label: 'OVERVIEW', items: [{ id: 'dashboard', href: '/superadmin', label: 'Dashboard', icon: 'dashboard' }] },
    { label: 'MANAGE', items: [
      { id: 'users', href: '/superadmin/users', label: 'Users', icon: 'users', badge: pendingUsers || undefined, badgeColor: '#b7791f' },
      { id: 'sessions', href: '/superadmin/sessions', label: 'Active Sessions', icon: 'sessions' },
    ] },
    { label: 'PLATFORM', items: [
      { id: 'connections', href: '/superadmin/connections', label: 'Connections', icon: 'connections' },
      { id: 'health', href: '/superadmin/system-health', label: 'System Health', icon: 'health', badge: healthIssues || undefined, badgeColor: '#c0352c' },
      { id: 'publishing', href: '/superadmin/publishing', label: 'Publishing Monitor', icon: 'publishing', badge: failedPublishing || undefined, badgeColor: '#c0352c' },
    ] },
    { label: 'MONITORING', items: [
      { id: 'auth', href: '/superadmin/auth-activity', label: 'Auth Activity', icon: 'auth' },
      { id: 'ai', href: '/superadmin/ai-usage', label: 'AI & Usage', icon: 'ai' },
      { id: 'logs', href: '/superadmin/logs', label: 'Logs', icon: 'audit' },
      { id: 'audit', href: '/superadmin/audit-logs', label: 'Audit Logs', icon: 'audit' },
    ] },
    { label: 'SYSTEM', items: [{ id: 'settings', href: '/superadmin/settings', label: 'Settings', icon: 'settings' }] },
  ];
}

const TITLES: Record<string, string> = {
  '/superadmin': 'Dashboard',
  '/superadmin/users': 'Users',
  '/superadmin/sessions': 'Active Sessions',
  '/superadmin/connections': 'Connections',
  '/superadmin/system-health': 'System Health',
  '/superadmin/publishing': 'Publishing Monitor',
  '/superadmin/auth-activity': 'Auth Activity',
  '/superadmin/ai-usage': 'AI & Usage',
  '/superadmin/logs': 'Logs',
  '/superadmin/audit-logs': 'Audit Logs',
  '/superadmin/settings': 'Settings',
};

const PATH_TO_ID: Record<string, string> = {
  '/superadmin': 'dashboard',
  '/superadmin/sessions': 'sessions',
  '/superadmin/connections': 'connections',
  '/superadmin/system-health': 'health',
  '/superadmin/publishing': 'publishing',
  '/superadmin/auth-activity': 'auth',
  '/superadmin/ai-usage': 'ai',
  '/superadmin/logs': 'logs',
  '/superadmin/audit-logs': 'audit',
  '/superadmin/settings': 'settings',
};

function pageTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/superadmin/users/')) return pathname.endsWith('/new') ? 'Create User' : 'User Detail';
  return 'Superadmin';
}

export default function SuperadminShell({ name, email, pendingUsers, healthIssues, failedPublishing, children }: {
  name: string; email: string; pendingUsers: number; healthIssues: number; failedPublishing: number; children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [vw, setVw] = useState(1400);
  const [navOpen, setNavOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    // Reading localStorage (an external, browser-only store) can't happen
    // during the initial render without risking a server/client hydration
    // mismatch — the server always renders 'light'. Applying the stored
    // preference only after mount is the standard fix for that (same
    // approach libraries like next-themes use), not a sync-effect anti-pattern.
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('sp_superadmin_theme') : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === 'dark' || stored === 'light') setTheme(stored);
    const onResize = () => setVw(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { window.localStorage.setItem('sp_superadmin_theme', next); } catch { /* private-mode storage block — theme just won't persist */ }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login-signup');
    router.refresh();
  }

  const isMobile = vw < 760;
  const tablet = !isMobile && vw < 1100;
  const collapsed = !isMobile && tablet;
  const groups = buildGroups(pendingUsers, healthIssues, failedPublishing);
  const current = pathname.startsWith('/superadmin/users') ? 'users' : PATH_TO_ID[pathname] || '';

  return (
    <div data-superadmin data-theme={theme} style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)', color: 'var(--tx)', fontSize: 14 }}>
      {isMobile && navOpen && (
        <div onClick={() => setNavOpen(false)} style={{ position: 'fixed', inset: 0, background: 'var(--ov)', zIndex: 40 }} />
      )}

      <aside style={{
        width: collapsed ? 72 : 248, flexShrink: 0, height: '100vh',
        position: isMobile ? 'fixed' : 'sticky', top: 0, left: 0, zIndex: 50,
        transform: isMobile && !navOpen ? 'translateX(-100%)' : 'none',
        transition: 'transform .25s, width .2s',
        background: '#0d0f2b', color: '#aeb0d4', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1b1d42',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '20px 18px 18px' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: '#6b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2,12 7,12 10,5 14,19 17,12 22,12" />
            </svg>
          </span>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: '0.02em' }}>SOCIALPULSE</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#a99fff', letterSpacing: '0.16em', marginTop: 2 }}>SUPERADMIN</div>
            </div>
          )}
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(g => (
            <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!collapsed && <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.14em', color: '#6f72a0', padding: '0 10px 6px' }}>{g.label}</div>}
              {g.items.map(n => {
                const active = current === n.id;
                return (
                  <Link
                    key={n.id}
                    href={n.href}
                    title={n.label}
                    onClick={() => setNavOpen(false)}
                    style={{
                      position: 'relative', display: 'flex', alignItems: 'center', gap: 11, width: '100%', height: 38, padding: '0 10px',
                      borderRadius: 9, background: active ? 'rgba(124,109,255,0.22)' : 'transparent', color: active ? '#fff' : '#aeb0d4',
                      fontWeight: active ? 700 : 600, textDecoration: 'none', justifyContent: collapsed ? 'center' : 'flex-start',
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d={ICONS[n.icon]} />
                    </svg>
                    {!collapsed && <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{n.label}</span>}
                    {!!n.badge && (
                      <span style={{
                        minWidth: 20, height: 18, padding: '0 6px', borderRadius: 999, background: n.badgeColor, color: '#fff',
                        fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: collapsed ? 'absolute' : 'static', top: 4, right: 4,
                      }}>
                        {n.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: 12, borderTop: '1px solid #1b1d42', display: 'flex', alignItems: 'center', gap: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: avatarColor(name), color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(name)}
          </span>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
              <div style={{ fontSize: 11.5, color: '#8b8eb8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <div style={{ padding: '0 12px 12px' }}>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #2a2d63', background: 'transparent', color: '#aeb0d4', fontSize: 12, fontWeight: 700, cursor: loggingOut ? 'default' : 'pointer', opacity: loggingOut ? 0.6 : 1 }}
            >
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        )}
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 30, background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {isMobile && (
            <button onClick={() => setNavOpen(true)} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--sf)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--mu)', fontFamily: 'var(--font-sa-mono), monospace' }}>{pathname}</div>
            <h1 style={{ margin: '2px 0 0', fontSize: 21, letterSpacing: '-0.02em', fontWeight: 800 }}>{pageTitle(pathname)}</h1>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px', borderRadius: 999, background: 'var(--oks)', color: 'var(--ok)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
            Live
          </span>
          <button onClick={() => router.refresh()} title="Reload data" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--sf)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
          </button>
          <button onClick={toggleTheme} title="Toggle theme" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--sf)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {theme === 'light' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            )}
          </button>
        </header>

        <main style={{ padding: '20px 24px 56px', width: '100%', maxWidth: 1440, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
