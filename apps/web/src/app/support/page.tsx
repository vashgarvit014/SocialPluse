import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SocialPulse Support",
  description:
    "Get help with SocialPulse — account and login, the Content Studio, the Canva integration, platform connections, scheduling and publishing, the Asset Gallery, and privacy.",
};

const H = { fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" } as const;

export default function SupportPage() {
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
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.03em", margin: 0 }}>SocialPulse Support</h1>
            <p style={{ fontSize: 14, color: "#475569", marginTop: 8 }}>Need help with SocialPulse or a connected platform? We&rsquo;re here to help.</p>
          </div>

          <div style={{ padding: "18px 28px 28px", display: "flex", flexDirection: "column", gap: 18, fontSize: 13, color: "#334155", lineHeight: 1.7 }}>
            <section>
              <h2 style={H}>Account &amp; Login</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Sign in or create an account from the login page using your email address.</li>
                <li>If a verification code doesn&rsquo;t arrive, check your spam folder and confirm the address you signed up with.</li>
                <li>If your session has expired, sign in again — your saved drafts and scheduled posts stay on your account.</li>
              </ul>
            </section>

            <section>
              <h2 style={H}>Content Studio</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Enter a topic and generate a caption, image, or carousel, then edit anything before using it.</li>
                <li>Your draft is saved as you work. If you refresh by accident, reopen the app and continue where you left off.</li>
                <li>Generated images can be regenerated, and uploaded media can be swapped or removed in the media tray.</li>
              </ul>
            </section>

            <section>
              <h2 style={H}>Canva Integration</h2>
              <p style={{ margin: "0 0 6px" }}>The Canva integration is optional — everything else in SocialPulse works without it.</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li><b>Connect Canva:</b> Connect Platforms → Canva → Connect, then approve the consent screen.</li>
                <li><b>Reconnect Canva:</b> if the connection expires or is revoked, reconnect from Connect Platforms.</li>
                <li><b>Disconnect Canva:</b> disconnecting Canva removes the SocialPulse connection for that user. You can also revoke access in Canva under Settings → Permitted apps.</li>
                <li><b>Create / Edit / Import:</b> where supported, you can send supported media to Canva as an editable design, edit it in Canva&rsquo;s editor, then import the result back into SocialPulse as a new image in your post.</li>
                <li>Canva keeps its own rules for anything you create there — see <a href="https://www.canva.com/policies/terms-of-use/" target="_blank" rel="noopener noreferrer" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>Canva&rsquo;s Terms of Use</a>.</li>
              </ul>
            </section>

            <section>
              <h2 style={H}>Platform Connections</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Connect, review, or disconnect LinkedIn, Facebook, Instagram, WhatsApp, and Canva from Connect Platforms.</li>
                <li>If a connection is marked as needing reconnection, the underlying token has expired or been revoked — reconnect the platform.</li>
                <li>We only ever publish to the specific accounts and pages you select and confirm.</li>
              </ul>
            </section>

            <section>
              <h2 style={H}>Scheduling &amp; Publishing</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Choose a date and time in the publish step, then confirm to schedule a post.</li>
                <li>Nothing is published automatically and we do not auto-retry — you always trigger the publish or schedule action yourself.</li>
                <li>Scheduled posts can be cancelled from the scheduler at any time.</li>
              </ul>
            </section>

            <section>
              <h2 style={H}>Asset Gallery</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Saved media — uploads, AI-generated images, Canva imports, and branded variants — is listed in the Asset Gallery.</li>
                <li>Assets are scoped to your account, so no other user can view your media.</li>
                <li>Saved media is retained for 30 days and then removed from our systems.</li>
              </ul>
            </section>

            <section>
              <h2 style={H}>Privacy &amp; Security</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>OAuth tokens are stored server-side only — never in your browser, never in a link, and never in logs.</li>
                <li>No other SocialPulse user can read or use your tokens, drafts, or saved media.</li>
                <li>You can disconnect a platform at any time, which deletes the stored token immediately.</li>
                <li>Full details are in our <a href="/privacy" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>Privacy Policy</a>. Our <a href="/terms" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>Terms of Service</a> covers acceptable use and your responsibilities.</li>
              </ul>
            </section>

            <div style={{ marginTop: 4, padding: "12px 14px", borderRadius: 10, backgroundColor: "#EFF6FF", border: "1px solid #DBEAFE", fontSize: 12, color: "#334155" }}>
              <b style={{ color: "#1E40AF" }}>Contact support:</b> email{" "}
              <a href="mailto:privacy@dotstark.tech" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>privacy@dotstark.tech</a>{" "}
              with a description of what you were trying to do and the message you saw. Please don&rsquo;t include account passwords.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap", marginTop: 14, fontSize: 12 }}>
          <a href="/terms" style={{ color: "#64748B", textDecoration: "none" }}>Terms</a>
          <a href="/support" style={{ color: "#64748B", textDecoration: "none" }}>Support</a>
          <a href="/privacy" style={{ color: "#64748B", textDecoration: "none" }}>Privacy Policy</a>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#94A3B8", marginTop: 14 }}>© 2026 SocialPulse — Dotstark Technologies</p>
      </main>
    </div>
  );
}