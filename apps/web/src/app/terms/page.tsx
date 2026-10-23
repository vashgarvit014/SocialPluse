import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SocialPulse Terms of Service",
  description:
    "Terms of Service for SocialPulse — AI content creation, branding, scheduling and publishing across LinkedIn, Facebook, Instagram, WhatsApp and Canva.",
};

export default function TermsPage() {
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
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.03em", margin: 0 }}>Terms of Service</h1>
            <p style={{ fontSize: 13, color: "#64748B", marginTop: 6 }}>Last updated: October 13, 2026 — SocialPulse by Dotstark Technologies</p>
            <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, marginTop: 12, backgroundColor: "#F8FAFC", border: "1px solid #F1F3F9", borderRadius: 10, padding: "10px 12px" }}>
              These Terms govern your use of SocialPulse. By creating an account or using the service you agree to them.
            </p>
          </div>

          <div style={{ padding: "18px 28px 28px", display: "flex", flexDirection: "column", gap: 18, fontSize: 13, color: "#334155", lineHeight: 1.7 }}>
            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>1. Acceptance of Terms</h2>
              <p style={{ margin: 0 }}>
                By registering an account, logging in, or otherwise using SocialPulse, you agree to these Terms and to our <a href="/privacy" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>Privacy Policy</a>. If you do not agree, do not use the service. You confirm you are legally able to enter into these terms.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>2. Description of SocialPulse</h2>
              <p style={{ margin: 0 }}>
                SocialPulse is a social media content creation, branding, scheduling and publishing platform. It lets you draft posts, generate captions, hashtags, images and carousels with AI, apply your brand assets, and schedule or publish content to the social platforms you connect.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>3. User Accounts</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>You are responsible for activity that occurs under your account and for keeping your credentials secure.</li>
                <li>You must provide accurate registration information and keep it up to date.</li>
                <li>You must be old enough to enter a binding contract where you live.</li>
                <li>You are responsible for all fees associated with any third-party services you choose to use with your content.</li>
              </ul>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>4. Acceptable Use</h2>
              <p style={{ margin: 0, marginBottom: 6 }}>You agree not to:</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Publish content that is unlawful, infringing, defamatory, hateful, or that promotes violence or exploitation.</li>
                <li>Upload or distribute malware, or attempt to gain unauthorised access to the service or its underlying systems.</li>
                <li>Circumvent usage limits, scrape, resell, or reverse engineer the service except where expressly permitted by law.</li>
                <li>Use SocialPulse to send unsolicited bulk messages, or to violate any platform&rsquo;s terms or policies.</li>
                <li>Misrepresent your identity or affiliation, or impersonate another person or organisation.</li>
              </ul>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>5. Third-Party Integrations</h2>
              <p style={{ margin: 0, marginBottom: 6 }}>
                SocialPulse integrates with third-party platforms. Each integration is optional and governed by that provider&rsquo;s own terms and policies, which you accept when you connect.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li><b>Canva (optional):</b> you can send a supported image to Canva as an editable design, edit it in Canva, and import the result back into SocialPulse. Connecting Canva is entirely voluntary and SocialPulse works without it. Content and designs you create in Canva remain subject to <a href="https://www.canva.com/policies/terms-of-use/" target="_blank" rel="noopener noreferrer" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>Canva&rsquo;s Terms of Use</a> and Privacy Policy. We do not post to your Canva account.</li>
                <li><b>LinkedIn:</b> governed by the LinkedIn User Agreement and Professional Community Policies.</li>
                <li><b>Facebook and Instagram:</b> governed by Meta&rsquo;s Terms of Service and Community Standards. Instagram access is granted through Meta Business Suite/Facebook Login.</li>
                <li><b>WhatsApp (where applicable):</b> governed by the WhatsApp Business Terms and Data Processing Terms.</li>
                <li><b>AI providers:</b> text and image generation is performed by third-party AI providers (including Inception, NVIDIA and Pollinations), which process your input under their own terms.</li>
              </ul>
              <p style={{ margin: "6px 0 0" }}>
                We are not responsible for third-party platforms&rsquo; availability, changes, or policies, and we do not control how they handle your content after you publish to them.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>6. User Content and Media</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>You retain all rights to the content you upload or create in SocialPulse.</li>
                <li>You grant us only the limited licence needed to host, process, transform, and display your content to you and to the platforms you direct — for example, to schedule a post or render an image for export.</li>
                <li>You are solely responsible for ensuring you have the rights to any media you upload and that your content does not infringe third-party rights.</li>
                <li>Saved media is retained for a limited period and then removed from our systems.</li>
              </ul>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>7. AI-Generated Content</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Captions, hashtags, images and carousels generated by AI are suggestions, not guaranteed output.</li>
                <li>AI output may be inaccurate or infringe rights, and you must review it before publishing.</li>
                <li>You are responsible for your use of generated content, including any claims you make about it.</li>
              </ul>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>8. Intellectual Property</h2>
              <p style={{ margin: 0 }}>
                The SocialPulse name, interface, and underlying software are owned by Dotstark Technologies. We grant you a limited, non-exclusive, non-transferable licence to use the service for its intended purpose. These Terms grant no rights to our trademarks beyond using the service as intended.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>9. Platform Availability</h2>
              <p style={{ margin: 0 }}>
                SocialPulse is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not guarantee uninterrupted, error-free or always-available operation, and we may modify, suspend, or discontinue features. Features may differ by region or depend on third-party platforms and AI providers we do not control.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>10. Suspension and Termination</h2>
              <p style={{ margin: 0 }}>
                You may stop using SocialPulse at any time and may disconnect any connected platform. We may suspend or terminate your access if you materially breach these Terms, violate a third-party platform&rsquo;s rules, or use the service in a way that harms us or others. Where practical we will give you notice and an opportunity to fix the issue first.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>11. Privacy and Data Handling</h2>
              <p style={{ margin: 0 }}>
                Our <a href="/privacy" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>Privacy Policy</a> describes what we collect, how OAuth tokens are stored server-side, what we share, and how to disconnect or request deletion. Connected-platform tokens are revoked on disconnect.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>12. Limitation of Liability</h2>
              <p style={{ margin: 0 }}>
                To the maximum extent permitted by law, Dotstark Technologies is not liable for any indirect, incidental, special or consequential damages, or for lost profits, revenue or data, arising from your use of SocialPulse or any content published through it. Our aggregate liability is limited to the greater of the amount you paid us in the twelve months before the claim, or USD 100. Nothing here excludes liability that cannot lawfully be excluded.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>13. Changes to These Terms</h2>
              <p style={{ margin: 0 }}>
                We may update these Terms. We will post the updated version on this page with a new &ldquo;Last updated&rdquo; date. Continuing to use SocialPulse after the update means you accept the revised terms.
              </p>
            </section>

            <section>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", margin: "0 0 6px" }}>14. Contact Information</h2>
              <p style={{ margin: 0 }}>
                Questions about these Terms can be sent to <a href="mailto:privacy@dotstark.tech" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>privacy@dotstark.tech</a>, or via the <a href="/support" style={{ color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>SocialPulse Support</a> page.
              </p>
            </section>

            <div style={{ marginTop: 4, padding: "10px 12px", borderRadius: 10, backgroundColor: "#EFF6FF", border: "1px solid #DBEAFE", fontSize: 12, color: "#334155" }}>
              <b style={{ color: "#1E40AF" }}>Note on Canva:</b> the Canva integration is optional. If you do not connect Canva, you can still create, brand, schedule and publish content in SocialPulse. Designs you make in Canva remain governed by Canva&rsquo;s terms.
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