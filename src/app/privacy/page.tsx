import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — SocialPulse",
  description: "Privacy policy for SocialPulse — how we handle LinkedIn and other platform data.",
};

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F7F8FC", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <header style={{ height: 64, backgroundColor: "#0f172a", color: "#fff", display: "flex", alignItems: "center", padding: "0 24px", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>SP</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em" }}>SocialPulse</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Content Manager</div>
        </div>
        <a href="/" style={{ marginLeft: "auto", color: "#cbd5e1", fontSize: 13, textDecoration: "none", border: "1px solid rgba(255,255,255,0.15)", padding: "7px 12px", borderRadius: 8 }}>← Back to app</a>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px 48px" }}>
        <div style={{ backgroundColor: "#fff", border: "1px solid #E8EAF1", borderRadius: 16, boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 28px rgba(15,23,42,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "28px 28px 0" }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.03em", margin: 0 }}>Privacy Policy</h1>
            <p style={{ fontSize: 13, color: "#64748B", marginTop: 6 }}>Last updated: September 14, 2026 — SocialPulse by Dotstark Technologies</p>
            <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, marginTop: 12, backgroundColor: "#F8FAFC", border: "1px solid #F1F3F9", borderRadius: 10, padding: "10px 12px" }}>
              This policy explains how SocialPulse handles data when you connect LinkedIn (including your personal profile and your LinkedIn Company Page via a business account) and other platforms.
            </p>
          </div>

          <div style={{ padding: "18px 28px 28px", display: "flex", flexDirection: "column", gap: 18, fontSize: 13, color: "#334155", lineHeight: 1.7 }}>
            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>1. Data we access</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li><b>LinkedIn OAuth:</b> name, email, member ID (OpenID), and the access token you grant. If you grant Company Page access, we also read the list of organizations you administrate (<code>organizationAcls</code>) and basic organization info to let you pick the publishing target.</li>
                <li><b>Content you create:</b> captions, hashtags, images/videos you upload or generate, and scheduling metadata.</li>
                <li><b>Other platforms (Facebook, Instagram, Canva):</b> analogous tokens and page/design IDs, only when you connect them.</li>
              </ul>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>2. How we use it</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Authenticate you and publish/schedule posts <b>only</b> to the accounts/pages you select and confirm.</li>
                <li>Generate AI content/images you request (topic → caption/hashtags via Inception/NVIDIA; images via Pollinations).</li>
                <li>Never post automatically without your explicit Publish/Schedule action; no auto-retry.</li>
              </ul>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>3. Storage</h2>
              <p style={{ margin: 0 }}>
                OAuth tokens are stored server-side only (<code>linkedin-tokens.json</code>, <code>facebook-tokens.json</code> on the app server, never in browser storage or URLs). They are not logged or returned to the client. Scheduled posts are stored locally in <code>scheduled-posts.json</code> until published.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>4. Sharing</h2>
              <p style={{ margin: 0 }}>We do not sell your data. Data is sent only to the platform APIs you authorize (LinkedIn, Facebook/Instagram Graph, Canva, and AI providers listed in our model docs) for the single purpose of completing your request.</p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>5. Disconnect &amp; deletion</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Disconnect any platform at any time via the app (Account card → Disconnect) — this deletes the server token immediately.</li>
                <li>You can also revoke access directly in LinkedIn &gt; Settings &gt; Permitted services or Meta Business Suite &gt; Integrations.</li>
                <li>Contact us to delete all stored data: <a href="mailto:privacy@dotstark.tech" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>privacy@dotstark.tech</a></li>
              </ul>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>6. Retention</h2>
              <p style={{ margin: 0 }}>Tokens are kept until you disconnect or they expire/revoke. Generated content lives in your browser draft/history until you clear it; scheduled-post records are kept locally until you cancel them.</p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>7. Contact</h2>
              <p style={{ margin: 0 }}>
                Dotstark Technologies, Software Development, 51–200 employees — LinkedIn Page verified Sep 7, 2026.<br />
                Email: <a href="mailto:privacy@dotstark.tech" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>privacy@dotstark.tech</a> · Web: <a href="https://socialpulse.dotstark.tech" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>socialpulse.dotstark.tech</a>
              </p>
            </section>

            <div style={{ marginTop: 4, padding: "10px 12px", borderRadius: 10, backgroundColor: "#EFF6FF", border: "1px solid #DBEAFE", fontSize: 12, color: "#334155" }}>
              <b style={{ color: "#1E40AF" }}>LinkedIn Company Page posting:</b> when you authorize <code>w_organization_social</code>, you are granting SocialPulse permission to create organic posts to the LinkedIn Company Page(s) you administrate, only when you click Publish/Schedule in the Studio. We never post to a Page you did not select.
            </div>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#94A3B8", marginTop: 14 }}>© 2026 SocialPulse — Dotstark Technologies</p>
      </main>
    </div>
  );
}
