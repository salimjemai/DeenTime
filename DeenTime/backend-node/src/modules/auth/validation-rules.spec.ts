import { describe, expect, it } from 'vitest';
import { z, type ZodType } from 'zod';
import { ProblemDetailsException } from '../../common/errors.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { displayName, emailAddress, exactLength, matches, maximumLength, minimumLength, must, notEmpty, optionalString, requiredString } from './validation-rules.js';

const context = { propertyName: 'ZipCode', displayName: 'Zip Code' };

describe('validation-rules', () => {
  it('splits PascalCase property names like FluentValidation', () => {
    expect(displayName('Email')).toBe('Email');
    expect(displayName('ConfirmPassword')).toBe('Confirm Password');
    expect(displayName('AddressPlaceId')).toBe('Address Place Id');
    expect(displayName('NewPassword')).toBe('New Password');
  });

  it('NotEmpty rejects null, empty and whitespace', () => {
    expect(notEmpty()(null, context)).toBe("'Zip Code' must not be empty.");
    expect(notEmpty()('', context)).toBe("'Zip Code' must not be empty.");
    expect(notEmpty()('   ', context)).toBe("'Zip Code' must not be empty.");
    expect(notEmpty()('78613', context)).toBeNull();
  });

  it('EmailAddress only requires a single @ that is neither first nor last', () => {
    const rule = emailAddress();
    expect(rule('a@b', context)).toBeNull();
    expect(rule(null, context)).toBeNull();
    for (const invalid of ['', 'ab', '@b', 'a@', 'a@@b']) expect(rule(invalid, context)).toBe("'Zip Code' is not a valid email address.");
  });

  it('length rules report the entered length and ignore null', () => {
    expect(maximumLength(3)('abcd', context)).toBe("The length of 'Zip Code' must be 3 characters or fewer. You entered 4 characters.");
    expect(maximumLength(3)('abc', context)).toBeNull();
    expect(minimumLength(3)('ab', context)).toBe("The length of 'Zip Code' must be at least 3 characters. You entered 2 characters.");
    expect(minimumLength(3)('abc', context)).toBeNull();
    expect(exactLength(2)('TXX', context)).toBe("'Zip Code' must be 2 characters in length. You entered 3 characters.");
    expect(exactLength(2)('TX', context)).toBeNull();
    for (const rule of [maximumLength(1), minimumLength(5), exactLength(2)]) expect(rule(null, context)).toBeNull();
  });

  it('Matches uses the default message unless one is given', () => {
    expect(matches(/^\d{5}$/)('1234', context)).toBe("'Zip Code' is not in the correct format.");
    expect(matches(/^\d{5}$/, 'Custom.')('1234', context)).toBe('Custom.');
    expect(matches(/^\d{5}$/)('78613', context)).toBeNull();
    expect(matches(/^\d{5}$/)(null, context)).toBeNull();
  });

  it('Must reports the given message when the predicate fails', () => {
    expect(must((value) => value === 'ok', 'Not ok.')('ok', context)).toBeNull();
    expect(must((value) => value === 'ok', 'Not ok.')('no', context)).toBe('Not ok.');
  });

  it('requiredString adds the implicit [Required] message before the chain and rejects non-strings', () => {
    const field = requiredString('Email', notEmpty(), emailAddress());
    expect(field.parse('a@b')).toBe('a@b');
    expect(messagesOf(field, undefined)).toEqual(['The Email field is required.', "'Email' must not be empty."]);
    expect(messagesOf(field, null)).toEqual(['The Email field is required.', "'Email' must not be empty."]);
    expect(messagesOf(field, '')).toEqual(["'Email' must not be empty.", "'Email' is not a valid email address."]);
    expect(messagesOf(field, 42)).toEqual(['The JSON value could not be converted to System.String.']);
  });

  it('optionalString yields null when missing and still runs the chain on values', () => {
    const field = optionalString('CaptchaToken', maximumLength(4));
    expect(field.parse(undefined)).toBeNull();
    expect(field.parse(null)).toBeNull();
    expect(field.parse('')).toBe('');
    expect(messagesOf(field, '12345')).toEqual(["The length of 'Captcha Token' must be 4 characters or fewer. You entered 5 characters."]);
  });

  it('reports missing object keys through the validation pipe with PascalCase keys', () => {
    const pipe = new ZodValidationPipe(z.object({ email: requiredString('Email', notEmpty()), captchaToken: optionalString('CaptchaToken') }));
    expect(pipe.transform({ email: 'a@b' })).toEqual({ email: 'a@b', captchaToken: null });
    expect(errorsOf(() => pipe.transform({}))).toEqual({ Email: ['The Email field is required.', "'Email' must not be empty."] });
  });
});

function messagesOf(schema: ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

function errorsOf(action: () => unknown): Record<string, string[]> | null {
  try {
    action();
    return null;
  } catch (error) {
    if (error instanceof ProblemDetailsException) return error.problem.errors ?? {};
    throw error;
  }
}
