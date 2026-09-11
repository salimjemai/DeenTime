import { z } from 'zod';

/**
 * FluentValidation-style string rules for zod: every rule in a chain runs (the
 * default CascadeMode.Continue) and reports the same message as the .NET
 * validators, while ASP.NET's implicit [Required] on non-nullable record
 * parameters is reported first as "The X field is required.".
 */
export interface RuleContext {
  propertyName: string;
  displayName: string;
}

/** Returns the failure message, or null when the rule passes. Rules receive null for a missing value. */
export type StringRule = (value: string | null, context: RuleContext) => string | null;

/** FluentValidation's default display name ("ConfirmPassword" → "Confirm Password"). */
export function displayName(propertyName: string): string {
  return propertyName.replace(/([a-z\d])([A-Z])/g, '$1 $2');
}

/** char.IsWhiteSpace as a character class (JS \s plus U+0085). */
export const WHITESPACE = /[\s\u0085]/;

/** string.IsNullOrWhiteSpace. */
export function isNullOrWhiteSpace(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

export const notEmpty =
  (): StringRule =>
  (value, { displayName: name }) =>
    isNullOrWhiteSpace(value) ? `'${name}' must not be empty.` : null;

/** FluentValidation's AspNetCoreCompatibleEmailValidator: exactly one '@' that is neither first nor last. */
export const emailAddress =
  (): StringRule =>
  (value, { displayName: name }) => {
    if (value === null) return null;
    const at = value.indexOf('@');
    return at > 0 && at !== value.length - 1 && at === value.lastIndexOf('@') ? null : `'${name}' is not a valid email address.`;
  };

export const maximumLength =
  (max: number): StringRule =>
  (value, { displayName: name }) =>
    value !== null && value.length > max ? `The length of '${name}' must be ${max} characters or fewer. You entered ${value.length} characters.` : null;

export const minimumLength =
  (min: number): StringRule =>
  (value, { displayName: name }) =>
    value !== null && value.length < min ? `The length of '${name}' must be at least ${min} characters. You entered ${value.length} characters.` : null;

export const exactLength =
  (length: number): StringRule =>
  (value, { displayName: name }) =>
    value !== null && value.length !== length ? `'${name}' must be ${length} characters in length. You entered ${value.length} characters.` : null;

export const matches =
  (pattern: RegExp, message?: string): StringRule =>
  (value, { displayName: name }) =>
    value !== null && !pattern.test(value) ? (message ?? `'${name}' is not in the correct format.`) : null;

export const must =
  (predicate: (value: string | null) => boolean, message: string): StringRule =>
  (value) =>
    predicate(value) ? null : message;

const NOT_A_STRING = 'The JSON value could not be converted to System.String.';

function readString(input: unknown, ctx: { addIssue: (issue: { code: 'custom'; message: string }) => void }): string | null | undefined {
  if (input === undefined || input === null) return null;
  if (typeof input === 'string') return input;
  ctx.addIssue({ code: 'custom', message: NOT_A_STRING });
  return undefined;
}

function applyRules(rules: StringRule[], value: string | null, context: RuleContext): string[] {
  const messages: string[] = [];
  for (const rule of rules) {
    const message = rule(value, context);
    if (message !== null) messages.push(message);
  }
  return messages;
}

/** A non-nullable `string` record parameter: implicitly [Required], then the FluentValidation chain. */
export function requiredString(propertyName: string, ...rules: StringRule[]) {
  const context: RuleContext = { propertyName, displayName: displayName(propertyName) };
  return z.unknown().transform((input, ctx): string => {
    const value = readString(input, ctx);
    if (value === undefined) return z.NEVER;
    const messages = value === null ? [`The ${propertyName} field is required.`] : [];
    messages.push(...applyRules(rules, value, context));
    for (const message of messages) ctx.addIssue({ code: 'custom', message });
    if (value === null || messages.length > 0) return z.NEVER;
    return value;
  });
}

/** A `string?` record parameter: null when missing, otherwise the FluentValidation chain. */
export function optionalString(propertyName: string, ...rules: StringRule[]) {
  const context: RuleContext = { propertyName, displayName: displayName(propertyName) };
  return z.unknown().transform((input, ctx): string | null => {
    const value = readString(input, ctx);
    if (value === undefined) return z.NEVER;
    const messages = applyRules(rules, value, context);
    for (const message of messages) ctx.addIssue({ code: 'custom', message });
    if (messages.length > 0) return z.NEVER;
    return value;
  });
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const US_ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

/** The password policy shared by RegisterRequestValidator.Password and ResetRequestValidator.NewPassword. */
export function passwordRules(): StringRule[] {
  return [
    notEmpty(),
    minimumLength(12),
    maximumLength(128),
    matches(/[a-z]/, 'Password must include a lowercase letter.'),
    matches(/[A-Z]/, 'Password must include an uppercase letter.'),
    matches(/[0-9]/, 'Password must include a number.'),
    matches(/[^A-Za-z0-9]/, 'Password must include a symbol.'),
    must((value) => value === null || !WHITESPACE.test(value), 'Password cannot contain spaces.'),
  ];
}
