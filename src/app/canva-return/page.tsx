'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Landed here from Canva's editor Return button (via /content-studio ->
// /api/canva/return, which already verified the JWT server-side). Job: hand
// the ready id to the SocialPulse tab that opened the editor, then close
// this tab. Canva autosaves the design on its side - nothing is exported
// until the user presses "Import from Canva" over there.
function ReturnHandshake() {
  const params = useSearchParams();
  const readyId = params.get('canva_ready');
  const error = params.get('error');
  const [closeFailed, setCloseFailed] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if ((readyId || error) && window.opener && !window.opener.closed) {
        window.opener.postMessage(
          readyId ? { type: 'canva-ready', readyId } : { type: 'canva-error', code: error },
          window.location.origin,
        );
        // Let the message dispatch, then close. Only script-opened tabs can
        // close themselves - ours always is (window.open, no noopener).
        timer = setTimeout(() => {
          window.close();
          // Still here? The browser refused - show the manual fallback.
          setCloseFailed(true);
        }, 500);
      }
    } catch {
      setCloseFailed(true);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [readyId, error]);

  const manualHref = readyId
    ? `/?canva_ready=${encodeURIComponent(readyId)}`
    : `/?error=${encodeURIComponent(error || 'CANVA_IMPORT_FAILED')}`;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', fontFamily: 'inherit', padding: 20 }}>
      <div style={{ backgroundColor: '#fff', borderRadius: 18, padding: '32px 36px', maxWidth: 440, textAlign: 'center', boxShadow: '0 24px 64px rgba(15,23,42,0.12)', border: '1px solid #E8EAF1' }}>
        <div style={{ fontSize: 34 }}>{readyId ? '✅' : '⚠️'}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>
          {readyId ? 'Design ready!' : 'Return failed'}
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, lineHeight: 1.6 }}>
          {readyId
            ? 'Your edited design was saved in Canva. This tab will close — then press “Import from Canva” in SocialPulse to bring it in.'
            : 'Canva could not hand the design back. Close this tab and try Edit in Canva again.'}
        </div>
        {(closeFailed || !readyId) && (
          <a
            href={manualHref}
            style={{ display: 'inline-block', marginTop: 18, padding: '11px 20px', borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
          >
            {readyId ? 'Open SocialPulse with my design →' : 'Back to SocialPulse →'}
          </a>
        )}
      </div>
    </div>
  );
}

export default function CanvaReturnPage() {
  return (
    <Suspense>
      <ReturnHandshake />
    </Suspense>
  );
}
