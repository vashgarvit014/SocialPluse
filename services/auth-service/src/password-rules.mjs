// Faithful port of src/lib/auth/password-rules.ts.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_REQUIREMENTS = [
  { key: 'length', test: pw => pw.length >= PASSWORD_MIN_LENGTH && pw.length <= PASSWORD_MAX_LENGTH },
  { key: 'uppercase', test: pw => /[A-Z]/.test(pw) },
  { key: 'lowercase', test: pw => /[a-z]/.test(pw) },
  { key: 'number', test: pw => /[0-9]/.test(pw) },
  { key: 'special', test: pw => /[^A-Za-z0-9]/.test(pw) },
];

export const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must contain at least 8 characters, including uppercase, lowercase, number, and special character.';

export function isPasswordValid(password) {
  return PASSWORD_REQUIREMENTS.every(r => r.test(password));
}
