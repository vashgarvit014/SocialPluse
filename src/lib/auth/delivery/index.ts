import 'server-only';
import { OTP_TTL_MINUTES, type OtpChannel, type OtpPurpose } from '../otp';
import { sendOtpEmail } from './email';
import { sendWhatsAppOtp } from './whatsapp-otp';

export type DeliveryResult = { ok: true } | { ok: false; error: string };

// The only thing auth route handlers know about delivery. Swapping SMTP for
// another email provider, or the Meta template for a different one, means
// editing exactly one adapter file — never this contract or the callers.
export async function deliverOtp(params: {
  channel: OtpChannel;
  destination: string;
  otp: string;
  purpose: OtpPurpose;
  // Roles the copy apart: a Superadmin's verification mail must identify the
  // privileged account immediately, otherwise a high-privilege code looks
  // like an ordinary one.
  isSuperadmin?: boolean;
}): Promise<DeliveryResult> {
  if (params.channel === 'EMAIL') {
    return sendOtpEmail({
      to: params.destination,
      otp: params.otp,
      purpose: params.purpose,
      expiresInMinutes: OTP_TTL_MINUTES,
      isSuperadmin: params.isSuperadmin,
    });
  }
  return sendWhatsAppOtp({ to: params.destination, otp: params.otp });
}
