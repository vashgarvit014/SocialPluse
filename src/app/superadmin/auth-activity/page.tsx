import Link from 'next/link';
import { listAuthEventsFiltered, listDistinctAuthEvents } from '@/lib/auth/audit';
import { avatarColor, initials, absTime, relTime, badge } from '../ui';

const EVENT_TONE: Record<string, string> = { bad: 'var(--bads)', warn: 'var(--warns)', ok: 'var(--oks)', neu: 'var(--neus)' };
const EVENT_TONE_FG: Record<string, string> = { bad: 'var(--bad)', warn: 'var(--warn)', ok: 'var(--ok)', neu: 'var(--neu)' };

function eventTone(event: string): string {
  if (/FAILED|SUSPENDED/.test(event)) return 'bad';
  if (/RESET|REQUESTED/.test(event)) return 'warn';
  if (/SUCCESS|VERIFIED|REACTIVATED|SIGNUP/.test(event)) return 'ok';
  return 'neu';
}

// Safe event log only — logAuthEvent() never writes raw OTPs, passwords,
// hashes, session tokens, or provider credentials into these rows (see
// audit.ts), so nothing here needs redacting on the way out.
export default async function SuperadminAuthActivityPage({ searchParams }: { searchParams: Promise<{ search?: string; event?: string; channel?: string }> }) {
  const { search = '', event = 'ALL', channel = 'ALL' } = await searchParams;

  const [events, distinctEvents] = await Promise.all([
    listAuthEventsFiltered({
      search: search || undefined,
      event: event !== 'ALL' ? event : undefined,
      channel: channel !== 'ALL' ? channel : undefined,
      limit: 150,
    }),
    listDistinctAuthEvents(),
  ]);

  return (
    <>
      <form method="GET" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 9, padding: '0 12px', height: 36, flex: '0 1 300px', minWidth: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--mu)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="text" name="search" defaultValue={search} placeholder="Search user or email" style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, minWidth: 0, height: 34 }} />
        </label>
        <select name="event" defaultValue={event} style={{ height: 36, border: '1px solid var(--bd)', background: 'var(--sf)', borderRadius: 9, padding: '0 10px', fontWeight: 600, cursor: 'pointer' }}>
          <option value="ALL">All events</option>
          {distinctEvents.map(e => <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>)}
        </select>
        <select name="channel" defaultValue={channel} style={{ height: 36, border: '1px solid var(--bd)', background: 'var(--sf)', borderRadius: 9, padding: '0 10px', fontWeight: 600, cursor: 'pointer' }}>
          <option value="ALL">All channels</option>
          <option value="EMAIL">Email</option>
          <option value="WHATSAPP">WhatsApp</option>
        </select>
        <button type="submit" style={{ height: 36, padding: '0 14px', borderRadius: 9, border: 'none', background: 'var(--ac)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Filter</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--mu)' }}>{events.length} event{events.length === 1 ? '' : 's'}</span>
      </form>

      <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.8fr 110px 1fr 100px', gap: 12, padding: '10px 16px', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--mu)', background: 'var(--sf2)', borderBottom: '1px solid var(--bd)' }}>
              <span>EVENT</span><span>USER</span><span>CHANNEL</span><span>TIME</span><span>RESULT</span>
            </div>
            {events.map(e => {
              const tone = eventTone(e.event);
              const res = badge(/FAILED/.test(e.event) ? 'FAILED' : 'SUCCESS');
              return (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.8fr 110px 1fr 100px', gap: 12, alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--bd)' }}>
                  <span>
                    <span style={{ fontFamily: 'var(--font-sa-mono), monospace', fontSize: 11.5, padding: '3px 8px', borderRadius: 6, background: EVENT_TONE[tone], color: EVENT_TONE_FG[tone] }}>{e.event}</span>
                  </span>
                  {e.userId && e.userName ? (
                    <Link href={`/superadmin/users/${e.userId}`} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                      <span style={{ width: 26, height: 26, borderRadius: '50%', background: avatarColor(e.userName), color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(e.userName)}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 700 }}>{e.userName}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.userEmail}</span>
                      </span>
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--mu)' }}>—</span>
                  )}
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>{e.channel || '—'}</span>
                  <span style={{ fontSize: 13 }}>{absTime(e.createdAt)}<span style={{ color: 'var(--mu)', fontSize: 12 }}> · {relTime(e.createdAt)}</span></span>
                  <span><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: res.bg, color: res.fg }}>{res.label}</span></span>
                </div>
              );
            })}
            {events.length === 0 && <div style={{ padding: 36, textAlign: 'center', color: 'var(--mu)' }}>No events match.</div>}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mu)' }}>OTP codes and password data are never recorded here.</div>
    </>
  );
}
