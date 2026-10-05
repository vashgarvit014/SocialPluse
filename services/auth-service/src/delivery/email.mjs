// Faithful port of src/lib/auth/delivery/email.ts — Mailjet SMTP relay via
// nodemailer. Same copy, same template per OTP purpose, same Superadmin-
// aware subject/body branching, same password-changed notification email.
import nodemailer from 'nodemailer';
import { isValidEmailFormat } from '../format-rules.mjs';

function getConfig() {
  const host = process.env.MAILJET_SMTP_HOST;
  const port = process.env.MAILJET_SMTP_PORT;
  const user = process.env.MAILJET_SMTP_USER;
  const pass = process.env.MAILJET_SMTP_PASS;
  const from = process.env.MAIL_FROM;
  if (!host || !port || !user || !pass || !from) return null;
  return { host, port: Number(port), user, pass, from };
}

let cachedTransport = null;
let cachedConfigKey = '';

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Nodemailer's defaults are deliberately generous (connectionTimeout 120s,
// greetingTimeout 30s, socketTimeout 600s). Because deliverOtp() awaits
// sendMail() inside the request handler, an unresponsive relay could tie up an
// auth request for MINUTES. Measured against this deployment: the first
// handshake costs ~6.5s and a warm one ~2.3s, which is why these are bounded
// below the gateway's upstream budget rather than left unbounded.
const SMTP_TIMEOUTS = { connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000 };

function getTransport(config) {
  const key = `${config.host}:${config.port}:${config.user}`;
  if (cachedTransport && cachedConfigKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    ...SMTP_TIMEOUTS,
  });
  cachedConfigKey = key;
  return cachedTransport;
}

// Opens the SMTP connection + TLS handshake at boot instead of inside the
// first user's request. Without this the very first OTP request of a deploy
// pays the full ~6.5s handshake, which alone can overrun the gateway's
// upstream timeout and surface to the user as a bare 503.
export function warmUpEmailTransport() {
  const config = getConfig();
  if (!config) return;
  getTransport(config)
    .verify()
    .then(() => { console.log('[auth/email] SMTP transport warmed'); })
    .catch((error) => {
      console.error('[auth/email] SMTP warm-up failed (will retry on first send):', error instanceof Error ? error.message : 'unknown error');
    });
}

const PURPOSE_COPY = {
  SIGNUP_VERIFY: 'Use the verification code below to finish creating your SocialPulse account.',
  LOGIN_VERIFY: 'Use the verification code below to finish logging in to SocialPulse.',
  PASSWORD_RESET: 'Use the verification code below to reset your SocialPulse password.',
  EMAIL_CHANGE: 'Use the verification code below to confirm your new email address.',
  MOBILE_CHANGE: 'Use the verification code below to confirm your new mobile number.',
};

export async function sendPasswordChangedEmail({ to, changedAt, ip, userAgent }) {
  if (!isValidEmailFormat(to)) {
    console.error('[auth/email-password-changed] refused to send: recipient failed format validation');
    return { ok: false, error: 'Invalid email address.' };
  }
  const config = getConfig();
  if (!config) {
    console.error('[auth/email-password-changed] not configured: one or more of MAILJET_SMTP_HOST/PORT/USER/PASS/MAIL_FROM is missing');
    return { ok: false, error: 'Email delivery is not configured.' };
  }
  const changedAtIso = changedAt.toISOString();
  const changedAtHtml = escapeHtml(changedAtIso);
  const ipHtml = ip ? escapeHtml(ip) : null;
  const uaHtml = userAgent ? escapeHtml(userAgent) : null;
  const details = [ip ? `IP address: ${ip}` : null, userAgent ? `Device: ${userAgent}` : null].filter(Boolean).join('\n');
  const detailsBlock = details ? `\n\nDetails of the change:\n${details}` : '';
  try {
    await getTransport(config).sendMail({
      from: config.from, to,
      subject: 'Your SocialPulse Superadmin password was changed',
      text: `Hello,\n\nThe password for your SocialPulse Superadmin account was just changed.\n\nWhen: ${changedAtIso}${detailsBlock}\n\nIf this was you, no further action is needed.\n\nIf you did NOT make this change, reset your password immediately and contact support.\n\nRegards,\nSocialPulse`,
      html: `<html><body style="margin:0;padding:0;background:#F7F8FC;"><div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;max-width:420px;margin:0 auto;padding:32px 28px;background:#fff;border-radius:16px;border:1px solid #eef0f6;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;"><span style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);display:inline-block;color:#fff;font-weight:800;font-size:13px;line-height:32px;text-align:center;">SP</span><span style="font-weight:800;font-size:16px;color:#0f1020;">SocialPulse</span></div><p style="font-size:14px;color:#334155;margin:0 0 16px;">The password for your SocialPulse Superadmin account was just changed.</p><div style="background:#F7F8FC;border-radius:12px;padding:14px 16px;margin:0 0 16px;"><p style="font-size:12.5px;color:#334155;margin:0 0 6px;"><strong>When:</strong> ${changedAtHtml}</p>${ipHtml ? `<p style="font-size:12.5px;color:#334155;margin:0 0 6px;"><strong>IP address:</strong> ${ipHtml}</p>` : ''}${uaHtml ? `<p style="font-size:12.5px;color:#334155;margin:0;"><strong>Device:</strong> ${uaHtml}</p>` : ''}</div><p style="font-size:12.5px;color:#64748b;margin:0 0 6px;">If this was you, no further action is needed.</p><p style="font-size:12.5px;color:#b91c1c;margin:0;">If you did <strong>not</strong> make this change, reset your password immediately and contact support.</p></div></body></html>`,
    });
    return { ok: true };
  } catch (error) {
    console.error('[auth/email-password-changed] delivery failed:', error instanceof Error ? error.message : 'unknown error');
    return { ok: false, error: 'Unable to send the password change notification.' };
  }
}

export async function sendOtpEmail({ to, otp, purpose, expiresInMinutes, isSuperadmin }) {
  if (!isValidEmailFormat(to)) {
    console.error('[auth/email-otp] refused to send: recipient failed format validation');
    return { ok: false, error: 'Unable to send the verification code by email. Please try again or use WhatsApp.' };
  }
  const config = getConfig();
  if (!config) {
    console.error('[auth/email-otp] not configured: one or more of MAILJET_SMTP_HOST/PORT/USER/PASS/MAIL_FROM is missing');
    return { ok: false, error: 'Email delivery is not configured.' };
  }
  try {
    const digits = otp.split('');
    const digitChips = digits.map(d => `<td style="padding:0 4px;"><div class="sp-otp-chip" style="width:40px;height:52px;line-height:52px;text-align:center;font-size:26px;font-weight:800;color:#0f1020;background:#fff;border:1.5px solid #E0DFFB;border-radius:10px;font-family:'SF Mono',Consolas,Menlo,monospace;">${d}</div></td>`).join('');
    const isEmailChange = purpose === 'EMAIL_CHANGE';
    const isSuperadminAccount = isSuperadmin === true && (purpose === 'PASSWORD_RESET' || purpose === 'LOGIN_VERIFY');
    const superadminAction = purpose === 'PASSWORD_RESET' ? 'Use it to reset your Superadmin password.' : 'Use it to finish logging in.';
    const lead = isEmailChange
      ? 'A request was made to change the email address associated with your SocialPulse Superadmin account. Here is the OTP for your email change:'
      : isSuperadminAccount ? `This verification code is for your SocialPulse Superadmin account. ${superadminAction}` : PURPOSE_COPY[purpose];
    const leadText = isEmailChange
      ? `A request was made to change the email address associated with your SocialPulse Superadmin account.\n\nHere is the OTP for your email change:\n\nOTP:\n${otp}\n\nThis code will expire in ${expiresInMinutes} minutes.\n\nIf you did not request this email change, you can ignore this email.\n\nRegards,\nSocialPulse`
      : isSuperadminAccount
        ? `This verification code is for your SocialPulse Superadmin account.\n\n${superadminAction}\n\nOTP:\n${otp}\n\nThis code will expire in ${expiresInMinutes} minutes.\n\nThis code grants access to a Superadmin account. If you did not request it, you can ignore this email.\n\nRegards,\nSocialPulse`
        : `Use the verification code below to continue with SocialPulse.\n\nOTP:\n${otp}\n\nCode expires in ${expiresInMinutes} minutes.\n\nIf you did not request this code, you can ignore this email.`;
    const footer = isEmailChange
      ? `This code will expire in ${expiresInMinutes} minutes. If you did not request this email change, you can ignore this email. Regards, SocialPulse`
      : isSuperadminAccount
        ? `This code will expire in ${expiresInMinutes} minutes. It grants access to a Superadmin account — if you did not request it, ignore this email and contact support.`
        : `Code expires in ${expiresInMinutes} minutes. If you did not request this code, you can ignore this email.`;
    await getTransport(config).sendMail({
      from: config.from, to,
      subject: isEmailChange ? 'SocialPulse Email Change Verification Code' : isSuperadminAccount ? 'SocialPulse Superadmin verification code' : 'Your SocialPulse verification code',
      text: leadText,
      html: `<html><head><style>@keyframes sp-otp-pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,108,255,0.35);border-color:#E0DFFB;}50%{box-shadow:0 0 0 6px rgba(124,108,255,0);border-color:#7C6CFF;}}.sp-otp-chip{animation:sp-otp-pulse 2.2s ease-in-out infinite;}</style></head><body style="margin:0;padding:0;background:#F7F8FC;"><div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;max-width:420px;margin:0 auto;padding:32px 28px;background:#fff;border-radius:16px;border:1px solid #eef0f6;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;"><span style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);display:inline-block;color:#fff;font-weight:800;font-size:13px;line-height:32px;text-align:center;">SP</span><span style="font-weight:800;font-size:16px;color:#0f1020;">SocialPulse</span></div><p style="font-size:14px;color:#334155;margin:0 0 18px;">${lead}</p><div style="background:#F7F8FC;border-radius:12px;padding:16px 12px;text-align:center;margin:0 0 10px;"><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${digitChips}</tr></table></div><p style="font-size:11.5px;color:#94a3b8;text-align:center;margin:0 0 18px;">👆 Tap and hold the code to copy</p><p style="font-size:12.5px;color:#94a3b8;margin:0;">${footer}</p></div></body></html>`,
    });
    return { ok: true };
  } catch (error) {
    console.error('[auth/email-otp] delivery failed:', error instanceof Error ? error.message : 'unknown error');
    return { ok: false, error: 'Unable to send the verification code by email. Please try again or use WhatsApp.' };
  }
}
