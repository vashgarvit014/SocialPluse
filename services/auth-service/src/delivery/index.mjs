// Faithful port of src/lib/auth/delivery/index.ts.
import { OTP_TTL_MINUTES } from '../otp.mjs';
import { sendOtpEmail } from './email.mjs';
import { sendWhatsAppOtp } from './whatsapp-otp.mjs';

export async function deliverOtp({ channel, destination, otp, purpose, isSuperadmin }) {
  if (channel === 'EMAIL') {
    return sendOtpEmail({ to: destination, otp, purpose, expiresInMinutes: OTP_TTL_MINUTES, isSuperadmin });
  }
  return sendWhatsAppOtp({ to: destination, otp });
}
