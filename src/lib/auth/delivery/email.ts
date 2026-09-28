import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import type { OtpPurpose } from '../otp';
import { isValidEmailFormat } from '../format-rules';

// Mailjet SMTP relay. Credentials are server-only env vars — never read
// from NEXT_PUBLIC_*, never returned from an API route, never logged (only
// the presence/absence of config is ever logged, never the values).
interface MailjetConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

function getConfig(): MailjetConfig | null {
  const host = process.env.MAILJET_SMTP_HOST;
  const port = process.env.MAILJET_SMTP_PORT;
  const user = process.env.MAILJET_SMTP_USER;
  const pass = process.env.MAILJET_SMTP_PASS;
  const from = process.env.MAIL_FROM;
  if (!host || !port || !user || !pass || !from) return null;
  return { host, port: Number(port), user, pass, from };
}

let cachedTransport: Transporter | null = null;
let cachedConfigKey = '';

function getTransport(config: MailjetConfig): Transporter {
  // Re-create only if the config actually changed (e.g. env reload in dev) —
  // avoids opening a fresh SMTP connection pool on every send.
  const key = `${config.host}:${config.port}:${config.user}`;
  if (cachedTransport && cachedConfigKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465, // 587 = STARTTLS, 465 = implicit TLS
    auth: { user: config.user, pass: config.pass },
  });
  cachedConfigKey = key;
  return cachedTransport;
}

const PURPOSE_COPY: Record<OtpPurpose, string> = {
  SIGNUP_VERIFY: 'Use the verification code below to finish creating your SocialPulse account.',
  LOGIN_VERIFY: 'Use the verification code below to finish logging in to SocialPulse.',
  PASSWORD_RESET: 'Use the verification code below to reset your SocialPulse password.',
  EMAIL_CHANGE: 'Use the verification code below to confirm your new email address.',
  MOBILE_CHANGE: 'Use the verification code below to confirm your new mobile number.',
};

export type SendOtpEmailResult = { ok: true } | { ok: false; error: string };

// The one function auth routes call for email delivery — swapping SMTP
// providers again later means editing only this file.
export async function sendOtpEmail(params: {
  to: string;
  otp: string;
  purpose: OtpPurpose;
  expiresInMinutes: number;
}): Promise<SendOtpEmailResult> {
  if (!isValidEmailFormat(params.to)) {
    // Never call Mailjet with something that isn't a real address.
    console.error('[auth/email-otp] refused to send: recipient failed format validation');
    return { ok: false, error: 'Unable to send the verification code by email. Please try again or use WhatsApp.' };
  }

  const config = getConfig();
  if (!config) {
    console.error('[auth/email-otp] not configured: one or more of MAILJET_SMTP_HOST/PORT/USER/PASS/MAIL_FROM is missing');
    return { ok: false, error: 'Email delivery is not configured.' };
  }

  try {
    // Individual "chip" boxes make the code visually obvious as a unit to
    // select/copy (email clients strip all JavaScript, so a real one-tap
    // clipboard button isn't technically possible here — this + the "tap
    // and hold" hint below is the honest equivalent). The @keyframes pulse
    // is ignored harmlessly by clients that don't support it (Gmail among
    // them) and simply renders static there; Apple Mail/Outlook desktop/etc.
    // will show the glow.
    const digits = params.otp.split('');
    const digitChips = digits.map(d => `<td style="padding:0 4px;"><div class="sp-otp-chip" style="width:40px;height:52px;line-height:52px;text-align:center;font-size:26px;font-weight:800;color:#0f1020;background:#fff;border:1.5px solid #E0DFFB;border-radius:10px;font-family:'SF Mono',Consolas,Menlo,monospace;">${d}</div></td>`).join('');

    await getTransport(config).sendMail({
      from: config.from,
      to: params.to,
      subject: 'Your SocialPulse verification code',
      text: `Use the verification code below to continue with SocialPulse.\n\nOTP:\n${params.otp}\n\nCode expires in ${params.expiresInMinutes} minutes.\n\nIf you did not request this code, you can ignore this email.`,
      html: `
        <html>
        <head>
          <style>
            @keyframes sp-otp-pulse {
              0%, 100% { box-shadow: 0 0 0 0 rgba(124,108,255,0.35); border-color: #E0DFFB; }
              50% { box-shadow: 0 0 0 6px rgba(124,108,255,0); border-color: #7C6CFF; }
            }
            .sp-otp-chip { animation: sp-otp-pulse 2.2s ease-in-out infinite; }
          </style>
        </head>
        <body style="margin:0;padding:0;background:#F7F8FC;">
        <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;max-width:420px;margin:0 auto;padding:32px 28px;background:#fff;border-radius:16px;border:1px solid #eef0f6;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
            <span style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);display:inline-block;color:#fff;font-weight:800;font-size:13px;line-height:32px;text-align:center;">SP</span>
            <span style="font-weight:800;font-size:16px;color:#0f1020;">SocialPulse</span>
          </div>
          <p style="font-size:14px;color:#334155;margin:0 0 18px;">${PURPOSE_COPY[params.purpose]}</p>
          <div style="background:#F7F8FC;border-radius:12px;padding:16px 12px;text-align:center;margin:0 0 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${digitChips}</tr></table>
          </div>
          <p style="font-size:11.5px;color:#94a3b8;text-align:center;margin:0 0 18px;">👆 Tap and hold the code to copy</p>
          <p style="font-size:12.5px;color:#94a3b8;margin:0;">Code expires in ${params.expiresInMinutes} minutes. If you did not request this code, you can ignore this email.</p>
        </div>
        </body>
        </html>
      `,
    });
    return { ok: true };
  } catch (error) {
    // Safe metadata only — never the OTP, never config.user/config.pass.
    console.error('[auth/email-otp] delivery failed:', error instanceof Error ? error.message : 'unknown error');
    return { ok: false, error: 'Unable to send the verification code by email. Please try again or use WhatsApp.' };
  }
}
