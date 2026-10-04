// Shared display helpers for the Superadmin UI — pure, no 'server-only',
// safe to import from both Server and Client Components. Visual language
// (avatar palette, tone mapping, relative-time formatting) matches the
// approved design reference; this file just gives the real data pipeline
// (users.ts / audit.ts / system-health.ts) the same look.

export const PAL = ['#6b5cf6', '#e0559a', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6'];

export function avatarColor(name: string): string {
  const sum = [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return PAL[sum % PAL.length];
}

export function initials(name: string): string {
  return String(name || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
}

export function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMin = (Date.now() - new Date(iso).getTime()) / 60000;
  const a = Math.abs(diffMin);
  const fut = diffMin < 0;
  const t = a < 1 ? 'now' : a < 60 ? `${Math.round(a)}m` : a < 1440 ? `${Math.round(a / 60)}h` : `${Math.round(a / 1440)}d`;
  return t === 'now' ? 'Just now' : fut ? `in ${t}` : `${t} ago`;
}

export function absTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

export function absDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export type Tone = 'ok' | 'warn' | 'bad' | 'ac' | 'neu';

const TONE_VARS: Record<Tone, [string, string]> = {
  ok: ['var(--oks)', 'var(--ok)'],
  warn: ['var(--warns)', 'var(--warn)'],
  bad: ['var(--bads)', 'var(--bad)'],
  ac: ['var(--acs)', 'var(--act)'],
  neu: ['var(--neus)', 'var(--neu)'],
};

export function toneOf(status: string): Tone {
  const u = String(status || '').toUpperCase().replace(/[_-]/g, ' ');
  if (/^(ACTIVE|OK|SUCCESS|VERIFIED|REACTIVATED)$/.test(u)) return 'ok';
  if (/^(PENDING|DEGRADED|NOT CONFIGURED|WARNING|REQUESTED|PASSWORD RESET)$/.test(u)) return 'warn';
  if (/^(SUSPENDED|ERROR|FAILED)$/.test(u)) return 'bad';
  return 'neu';
}

export function nicify(x: string): string {
  return String(x || '—').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

export function badge(status: string): { label: string; bg: string; fg: string } {
  const [bg, fg] = TONE_VARS[toneOf(status)];
  return { label: nicify(status), bg, fg };
}
