// Faithful port of src/lib/auth/schemas.ts.
import { z } from 'zod';
import { isValidName, isValidEmailFormat } from './format-rules.mjs';
import { isPasswordValid, PASSWORD_REQUIREMENTS_MESSAGE, PASSWORD_MAX_LENGTH } from './password-rules.mjs';
import { isValidMobile, normalizeMobile } from './mobile.mjs';

const NAME_MESSAGE = 'Please enter a valid name.';
const EMAIL_MESSAGE = 'Please enter a valid email address.';
const MOBILE_MESSAGE = 'Please enter a valid mobile number with country code (e.g. +919876543210).';
const OTP_MESSAGE = 'Enter a valid 6-digit verification code.';
const IDENTIFIER_MESSAGE = 'Please enter a valid email or mobile number.';

export const nameSchema = z.string().trim().min(2, NAME_MESSAGE).max(60, NAME_MESSAGE).refine(isValidName, NAME_MESSAGE);

export const emailSchema = z
  .string()
  .transform(v => v.trim().toLowerCase())
  .pipe(z.string().min(1, EMAIL_MESSAGE).max(254, EMAIL_MESSAGE).refine(isValidEmailFormat, EMAIL_MESSAGE));

export const mobileSchema = z
  .string()
  .transform(v => normalizeMobile(v))
  .pipe(z.string().refine(isValidMobile, MOBILE_MESSAGE));

export const passwordSchema = z
  .string()
  .min(8, PASSWORD_REQUIREMENTS_MESSAGE)
  .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`)
  .refine(isPasswordValid, PASSWORD_REQUIREMENTS_MESSAGE);

export const otpSchema = z.string().regex(/^\d{6}$/, OTP_MESSAGE);

export const loginIdentifierSchema = z
  .string()
  .trim()
  .min(1, IDENTIFIER_MESSAGE)
  .refine(v => (v.includes('@') ? isValidEmailFormat(v) : isValidMobile(normalizeMobile(v))), IDENTIFIER_MESSAGE);

export const signupSchema = z
  .object({ name: nameSchema, email: emailSchema, mobile: mobileSchema, password: passwordSchema, confirmPassword: z.string() })
  .refine(data => data.password === data.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });

export const loginSchema = z.object({
  identifier: loginIdentifierSchema,
  password: z.string().min(1, 'Please enter your password.'),
});

export const otpRequestSchema = z.object({ channel: z.enum(['EMAIL', 'WHATSAPP']) });
export const otpVerifySchema = z.object({ challengeId: z.string().min(1), otp: otpSchema });
export const otpResendSchema = z.object({ challengeId: z.string().min(1) });
export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(1, IDENTIFIER_MESSAGE) });

export const resetPasswordSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine(data => data.newPassword === data.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });
