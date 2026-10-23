import { absTime, badge } from '../../../ui';
import { callAdminService as callAdminGateway } from '@/lib/admin-client';
import IncidentActions from './actions';

export const dynamic = 'force-dynamic';

interface Incident {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  source: string;
  platform: string | null;
  category: string;
  decision: string;
  status: string;
  confidence: string | null;
  method: string;
  content_preview: string | null;
  media_asset_id: string | null;
  media_restricted: boolean;
  violation_count_after: number | null;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export default async function ViolationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await callAdminGateway(`/moderation/violations/${id}`);
  if (!res.ok) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)' }}>Incident not found or temporarily unavailable.</div>;
  }
  const data = res.data as { incident: Incident; mediaViewUrl?: string };
  const incident = data.incident;
  const st = badge(incident.status === 'BLOCKED' || incident.status === 'UNDER_REVIEW' ? 'SUSPENDED' : incident.status === 'UNCERTAIN' ? 'PENDING' : 'ACTIVE');
  const isRestricted = incident.category === 'RESTRICTED_CSAM' || incident.media_restricted;
  const browserMediaUrl = data.mediaViewUrl ? `/api/superadmin${data.mediaViewUrl}` : undefined;

  const rows: Array<[string, string]> = [
    ['User', `${incident.user_name} (${incident.user_email})`],
    ['Source', incident.source.replace(/_/g, ' ')],
    ['Platform', incident.platform || '—'],
    ['Category', incident.category.replace(/_/g, ' ')],
    ['Decision', incident.decision.replace(/_/g, ' ')],
    ['Detection Method', incident.method.replace(/_/g, ' ')],
    ['Confidence', incident.confidence || '—'],
    ['Violation Count (at time)', String(incident.violation_count_after ?? '—')],
    ['Detected', absTime(incident.created_at)],
    ['Reviewed At', incident.reviewed_at ? absTime(incident.reviewed_at) : '—'],
    ['Review Note', incident.review_note || '—'],
  ];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <a href="/superadmin/moderation/violations" style={{ fontSize: 12.5, fontWeight: 700, color: '#6b5cf6', textDecoration: 'none' }}>← All Violations</a>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Incident Detail</h1>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: st.bg, color: st.fg }}>{incident.status.replace(/_/g, ' ')}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 16 }}>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '2px 20px', marginBottom: 16 }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--bd)', fontSize: 12.5 }}>
                <span style={{ color: 'var(--mu)' }}>{k}</span>
                <span style={{ fontWeight: 700, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Content</div>
            {isRestricted ? (
              <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--ers)', color: 'var(--er)', fontSize: 13, fontWeight: 700 }}>
                Restricted — content withheld, escalation flagged. Follow your organization&apos;s legal reporting process.
              </div>
            ) : (
              <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--sf2)', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                {incident.content_preview || <span style={{ color: 'var(--mu)' }}>No text preview available for this category.</span>}
              </div>
            )}
          </div>

          {incident.media_asset_id && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Flagged Media</div>
              {isRestricted || !browserMediaUrl ? (
                <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--ers)', color: 'var(--er)', fontSize: 13, fontWeight: 700 }}>
                  Restricted — no preview available.
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={browserMediaUrl} alt="Flagged media" style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 10, border: '1px solid var(--bd)' }} />
              )}
              <p style={{ fontSize: 11, color: 'var(--mu)', marginTop: 8 }}>
                This link is short-lived (5 minutes) and single-purpose. Every view of this media is audited.
              </p>
            </div>
          )}
        </div>

        <IncidentActions incidentId={incident.id} status={incident.status} />
      </div>
    </>
  );
}
