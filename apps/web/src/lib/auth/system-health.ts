import 'server-only';
import { query } from '@/lib/db';

export type HealthStatus = 'OK' | 'NOT_CONFIGURED' | 'ERROR';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail: string;
}

// Deliberately cheap: DB gets one trivial SELECT 1 (the app's own
// connection pool, not a third-party call), everything else is only
// checked for "are its env vars present" — never a live call out to Canva,
// LinkedIn, Facebook, Meta, Mailjet, or Whapi. Per spec: no expensive
// provider API calls on every dashboard render, and never expose secret
// values themselves, only whether they're configured.
function envConfigured(...names: string[]): HealthCheck['status'] {
  return names.every(n => !!process.env[n]?.trim()) ? 'OK' : 'NOT_CONFIGURED';
}

export async function getSystemHealth(): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  try {
    await query('SELECT 1');
    checks.push({ name: 'Database (PostgreSQL)', status: 'OK', detail: 'Connected' });
  } catch (error) {
    checks.push({ name: 'Database (PostgreSQL)', status: 'ERROR', detail: error instanceof Error ? error.message : 'Connection failed' });
  }

  checks.push({
    name: 'SMTP (Email OTP delivery)',
    status: envConfigured('MAILJET_SMTP_HOST', 'MAILJET_SMTP_USER', 'MAILJET_SMTP_PASS', 'MAIL_FROM'),
    detail: 'Used for signup/login/password-reset email OTPs',
  });

  checks.push({
    name: 'Meta WhatsApp Cloud API (WhatsApp OTP delivery)',
    status: envConfigured('META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID'),
    detail: 'Used ONLY for authentication OTPs — separate from Whapi below',
  });

  checks.push({
    name: 'Whapi (WhatsApp group publishing)',
    status: envConfigured('WHAPI_API_BASE', 'WHAPI_API_TOKEN'),
    detail: 'Content publishing to WhatsApp groups — never used for OTP',
  });

  // Only "are both vars present" is checkable here.
  //
  // An earlier version of this probe called Canva's authorize endpoint from the
  // server to validate the client_id. That is WRONG and was removed: Canva sits
  // behind a Cloudflare bot challenge, so a server-side fetch returns a 403
  // interstitial ("Enable JavaScript and cookies to continue") no matter whether
  // the client_id is valid. The check would have reported ERROR for a perfectly
  // good credential and sent an admin chasing a non-existent problem.
  checks.push({
    name: 'Canva',
    status: envConfigured('CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'),
    detail: 'Design import integration — validity can only be confirmed by completing Connect in a browser',
  });
  checks.push({ name: 'LinkedIn', status: envConfigured('LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'), detail: 'Publishing integration' });
  checks.push({ name: 'Facebook', status: envConfigured('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'), detail: 'Publishing integration' });
  checks.push({
    name: 'Instagram',
    status: envConfigured('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'),
    detail: 'Publishing rides on a connected Facebook Page — same Meta app credentials as Facebook',
  });
  checks.push({
    name: 'WhatsApp Cloud API (content publishing)',
    status: envConfigured('WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'),
    detail: 'Separate from Meta WhatsApp OTP delivery above',
  });

  return checks;
}
