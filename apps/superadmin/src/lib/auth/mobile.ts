// Pure string logic, no secrets — deliberately NOT 'server-only' so the
// client can run the exact same normalize/validate the server does (see
// schemas.ts) instead of a second, potentially-drifting copy.
//
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

const E164_RE = /^\+[1-9]\d{7,14}$/;

export function normalizeMobile(input: string): string {
  const stripped = input.trim().replace(/[\s\-().]/g, '');
  return stripped.startsWith('00') ? `+${stripped.slice(2)}` : stripped;
}

export function isValidMobile(input: string): boolean {
  const normalized = normalizeMobile(input);
  if (!normalized.startsWith('+')) return false;
  return parsePhoneNumberFromString(normalized)?.isValid() === true;
}

export function isLegacyE164Mobile(input: string): boolean {
  return E164_RE.test(normalizeMobile(input));
}

// "+919876543210" -> "+91 ******3210"
export function maskMobile(mobile: string): string {
  const cc = mobile.match(/^\+\d{1,3}/)?.[0] || '+';
  const rest = mobile.slice(cc.length);
  if (rest.length <= 4) return `${cc} ${'*'.repeat(rest.length)}`;
  return `${cc} ${'*'.repeat(rest.length - 4)}${rest.slice(-4)}`;
}

// "someone@example.com" -> "so***@example.com"
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 2))}@${domain}`;
}
