import { z } from 'zod';
import { EMAIL_PATTERN, US_ZIP_PATTERN, emailAddress, exactLength, matches, maximumLength, notEmpty, optionalString, passwordRules, requiredString } from './validation-rules.js';

/** RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(320).Matches(...).WithMessage("Enter a valid email address."). */
const email = () => requiredString('Email', notEmpty(), emailAddress(), maximumLength(320), matches(EMAIL_PATTERN, 'Enter a valid email address.'));

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const registerFields = z.object({
  email: email(),
  password: requiredString('Password', ...passwordRules()),
  confirmPassword: requiredString('ConfirmPassword'),
  organizationName: requiredString('OrganizationName', notEmpty(), maximumLength(160)),
  websiteUrl: requiredString('WebsiteUrl', notEmpty(), maximumLength(2048)),
  addressLine: requiredString('AddressLine', notEmpty(), maximumLength(240)),
  city: requiredString('City', notEmpty(), maximumLength(120)),
  state: requiredString('State', notEmpty(), exactLength(2)),
  zipCode: requiredString('ZipCode', notEmpty(), matches(US_ZIP_PATTERN)),
  addressPlaceId: optionalString('AddressPlaceId', maximumLength(512)),
  captchaToken: optionalString('CaptchaToken', maximumLength(2048)),
  invitationToken: optionalString('InvitationToken', maximumLength(512)),
});
export type RegisterRequest = z.infer<typeof registerFields>;

/**
 * RegisterRequest + RegisterRequestValidator. The field rules run first; then
 * RuleFor(x => x.ConfirmPassword).Equal(x => x.Password) compares the raw values,
 * which FluentValidation does even when the password itself failed its rules.
 */
export const registerSchema = z.unknown().transform((raw, ctx): RegisterRequest => {
  const parsed = registerFields.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message });
  }
  const input = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mismatch = stringOrNull(input.confirmPassword) !== stringOrNull(input.password);
  if (mismatch) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match.' });
  if (!parsed.success || mismatch) return z.NEVER;
  return parsed.data;
});

/** LoginRequest + LoginRequestValidator. */
export const loginSchema = z.object({
  email: email(),
  password: requiredString('Password', notEmpty(), maximumLength(128)),
  captchaToken: optionalString('CaptchaToken', maximumLength(2048)),
});
export type LoginRequest = z.infer<typeof loginSchema>;

/** VerifyEmailRequest + VerifyEmailRequestValidator. */
export const verifyEmailSchema = z.object({
  token: requiredString('Token', notEmpty(), maximumLength(512)),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailSchema>;

/** ForgotRequest + ForgotRequestValidator. */
export const forgotSchema = z.object({
  email: requiredString('Email', notEmpty(), emailAddress()),
});
export type ForgotRequest = z.infer<typeof forgotSchema>;

/** ResetRequest + ResetRequestValidator. */
export const resetSchema = z.object({
  token: requiredString('Token', notEmpty()),
  newPassword: requiredString('NewPassword', ...passwordRules()),
});
export type ResetRequest = z.infer<typeof resetSchema>;
