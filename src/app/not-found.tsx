import Link from 'next/link';

// Global 404 — rendered by Next for ANY unmatched path on ANY host, so
// /super, /superadmin-typo, /anything-at-all all land here with a real 404
// status and the site's own visual language, instead of Next's unstyled
// default page (which also inherited the dashboard's <title>).
//
// src/app/404/page.tsx renders this same screen on purpose: the proxy rewrites
// blocked paths there so they get a 404 STATUS with styled content. Returning
// a bare 404 from the proxy would only produce plain text, and a rewrite can
// never carry a 404 status by itself.
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 55%, #f5f3ff 100%)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440, textAlign: 'center' }}>
        <div
          style={{
            width: 76,
            height: 76,
            margin: '0 auto 22px',
            borderRadius: 22,
            background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
            color: '#fff',
            fontSize: 26,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 30px rgba(124, 58, 237, 0.28)',
          }}
        >
          404
        </div>

        <h1
          style={{
            margin: '0 0 10px',
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: '#0F172A',
          }}
        >
          This page could not be found.
        </h1>

        <p style={{ margin: '0 0 26px', fontSize: 14, lineHeight: 1.65, color: '#64748B' }}>
          The page you are looking for doesn&apos;t exist or may have been moved.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/"
            style={{
              padding: '11px 22px',
              borderRadius: 11,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              color: '#fff',
              background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
            }}
          >
            Back to Home
          </Link>
          <Link
            href="/login-signup"
            style={{
              padding: '11px 22px',
              borderRadius: 11,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              color: '#334155',
              background: '#fff',
              border: '1px solid #E2E8F0',
            }}
          >
            Go to Login
          </Link>
        </div>
      </div>
    </main>
  );
}