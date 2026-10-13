'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Landed here from Canva's editor Return button (via /content-studio ->
// /api/canva/return, which already verified the JWT server-side). Job: hand
// the ready id to the SocialPulse tab that opened the editor, then STAY OPEN
// for the user to close manually - this tab is never auto-closed and never
// navigates the SocialPulse tab. Canva autosaves the design on its side -
// nothing is exported until the user presses "Import from Canva" over there.
//
// WHERE TO SEND THE USER BACK TO: the app shell (SocialMediaManager), which is
// the only thing that reads ?canva_ready / ?editor_return, is served by the
// thin route pages under /dashboard, /content-studio, /scheduler, /analytics,
// /connect-platforms and /asset-gallery. The bare root "/" is the MARKETING
// landing page since the shell was moved out of it - it never reads either
// param, so a fallback aimed at "/" dropped the ready id on the floor and the
// user saw the homepage with no editor and no Import button, i.e. the return
// looked like it had silently done nothing. /dashboard is the same landing
// spot /oauth-return already uses for the OAuth half of this flow.
const SHELL_HOME = '/dashboard';

function ReturnHandshake() {
  const params = useSearchParams();
  const readyId = params.get('canva_ready');
  const error = params.get('error');
  const [delivered, setDelivered] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem('canva-editor-return');
    if (saved && !window.opener) {
      const query = new URLSearchParams({ editor_return: saved });
      if (readyId) query.set('canva_ready', readyId);
      if (error) query.set('error', error);
      sessionStorage.removeItem('canva-editor-return');
      location.replace(`${SHELL_HOME}?${query.toString()}`); return;
    }
    try {
      if ((readyId || error) && window.opener && !window.opener.closed) {
        window.opener.postMessage(
          readyId ? { type: 'canva-ready', readyId } : { type: 'canva-error', code: error },
          window.location.origin,
        );
        setDelivered(true);
      }
    } catch {
      setDelivered(false);
    }
  }, [readyId, error]);

  const manualHref = readyId
    ? `${SHELL_HOME}?canva_ready=${encodeURIComponent(readyId)}`
    : `${SHELL_HOME}?error=${encodeURIComponent(error || 'CANVA_IMPORT_FAILED')}`;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', fontFamily: 'inherit', padding: 20 }}>
      <div style={{ backgroundColor: '#fff', borderRadius: 18, padding: '32px 36px', maxWidth: 440, textAlign: 'center', boxShadow: '0 24px 64px rgba(15,23,42,0.12)', border: '1px solid #E8EAF1' }}>
        <div style={{ fontSize: 34 }}>{readyId ? '✅' : '⚠️'}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>
          {readyId ? 'Design ready!' : 'Return failed'}
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, lineHeight: 1.6 }}>
          {readyId
            ? 'Your edited design was saved in Canva. Switch back to your SocialPulse tab and press “Import from Canva” to bring it in — nothing is imported automatically. You can close this tab whenever you like.'
            : 'Canva could not hand the design back. Close this tab and try Edit in Canva again.'}
        </div>
        {readyId && (
          <button
            onClick={() => window.close()}
            style={{ display: 'inline-block', marginTop: 18, marginRight: 8, padding: '11px 20px', borderRadius: 10, background: '#fff', border: '1px solid #E2E8F0', color: '#334155', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Close this tab
          </button>
        )}
        {(!delivered || !readyId) && (
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
