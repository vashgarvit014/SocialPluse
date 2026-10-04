// Pure format checks, not 'server-only' — imported by both the live
// requirement checklist in the UI and the server-side Zod schema (see
// schemas.ts), so the two can never drift apart.
export interface PasswordRequirement {
  key: 'length' | 'uppercase' | 'lowercase' | 'number' | 'special';
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { key: 'length', label: `${PASSWORD_MIN_LENGTH}+ characters`, test: pw => pw.length >= PASSWORD_MIN_LENGTH && pw.length <= PASSWORD_MAX_LENGTH },
  { key: 'uppercase', label: '1 uppercase letter', test: pw => /[A-Z]/.test(pw) },
  { key: 'lowercase', label: '1 lowercase letter', test: pw => /[a-z]/.test(pw) },
  { key: 'number', label: '1 number', test: pw => /[0-9]/.test(pw) },
  { key: 'special', label: '1 special character', test: pw => /[^A-Za-z0-9]/.test(pw) },
];

export const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must contain at least 8 characters, including uppercase, lowercase, number, and special character.';

export function isPasswordValid(password: string): boolean {
  return PASSWORD_REQUIREMENTS.every(r => r.test(password));
}
