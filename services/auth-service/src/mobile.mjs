// Faithful port of src/lib/auth/mobile.ts.
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function normalizeMobile(input) {
  const stripped = input.trim().replace(/[\s\-().]/g, '');
  return stripped.startsWith('00') ? `+${stripped.slice(2)}` : stripped;
}

export function isValidMobile(input) {
  return E164_RE.test(normalizeMobile(input));
}

export function maskMobile(mobile) {
  const cc = mobile.match(/^\+\d{1,3}/)?.[0] || '+';
  const rest = mobile.slice(cc.length);
  if (rest.length <= 4) return `${cc} ${'*'.repeat(rest.length)}`;
  return `${cc} ${'*'.repeat(rest.length - 4)}${rest.slice(-4)}`;
}

export function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 2))}@${domain}`;
}
