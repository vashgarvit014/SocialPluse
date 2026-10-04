// Faithful port of src/lib/auth/format-rules.ts.
const NAME_TOKEN_RE = /^\p{L}+(?:['-]\p{L}+)*\.?$/u;

export function isValidName(name) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  const tokens = trimmed.split(/\s+/);
  return tokens.length > 0 && tokens.every(t => NAME_TOKEN_RE.test(t));
}

const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isValidEmailFormat(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}
