import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { ProblemDetailsException } from '../../common/errors.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { forgotSchema, loginSchema, registerSchema, resetSchema, verifyEmailSchema } from './auth.schemas.js';

/** The ValidationProblemDetails.errors dictionary the pipe produces, or null when the body is valid. */
function errorsOf<T>(schema: ZodType<T>, input: unknown): Record<string, string[]> | null {
  try {
    new ZodValidationPipe(schema).transform(input);
    return null;
  } catch (error) {
    if (error instanceof ProblemDetailsException) return error.problem.errors ?? {};
    throw error;
  }
}

const validRegistration = {
  email: 'new-admin@masjid.test',
  password: 'A-strong-test-password-1234',
  confirmPassword: 'A-strong-test-password-1234',
  organizationName: 'Cedar Park Test Masjid',
  websiteUrl: 'https://www.cedar-park-test.example/about',
  addressLine: '123 Masjid Way',
  city: 'Cedar Park',
  state: 'TX',
  zipCode: '78613',
};

describe('registerSchema (RegisterRequestValidator)', () => {
  it('accepts a valid registration and nulls the optional fields', () => {
    expect(new ZodValidationPipe(registerSchema).transform(validRegistration)).toEqual({
      ...validRegistration,
      addressPlaceId: null,
      captchaToken: null,
      invitationToken: null,
    });
    expect(errorsOf(registerSchema, { ...validRegistration, addressPlaceId: 'place', captchaToken: 'captcha', invitationToken: 'invite', zipCode: '78613-1234' })).toBeNull();
  });

  it('reports every failing rule with the FluentValidation messages (verified against the .NET API)', () => {
    expect(
      errorsOf(registerSchema, {
        email: 'not-an-email',
        password: 'short',
        confirmPassword: 'different',
        organizationName: '',
        websiteUrl: '',
        addressLine: '',
        city: '',
        state: 'TXX',
        zipCode: '1234',
        addressPlaceId: 'x'.repeat(513),
        captchaToken: 'x'.repeat(2049),
        invitationToken: 'x'.repeat(513),
      }),
    ).toEqual({
      Email: ["'Email' is not a valid email address.", 'Enter a valid email address.'],
      Password: [
        "The length of 'Password' must be at least 12 characters. You entered 5 characters.",
        'Password must include an uppercase letter.',
        'Password must include a number.',
        'Password must include a symbol.',
      ],
      ConfirmPassword: ['Passwords do not match.'],
      OrganizationName: ["'Organization Name' must not be empty."],
      WebsiteUrl: ["'Website Url' must not be empty."],
      AddressLine: ["'Address Line' must not be empty."],
      City: ["'City' must not be empty."],
      State: ["'State' must be 2 characters in length. You entered 3 characters."],
      ZipCode: ["'Zip Code' is not in the correct format."],
      AddressPlaceId: ["The length of 'Address Place Id' must be 512 characters or fewer. You entered 513 characters."],
      CaptchaToken: ["The length of 'Captcha Token' must be 2048 characters or fewer. You entered 2049 characters."],
      InvitationToken: ["The length of 'Invitation Token' must be 512 characters or fewer. You entered 513 characters."],
    });
  });

  it('reports the implicit [Required] and NotEmpty messages for an empty body', () => {
    expect(errorsOf(registerSchema, {})).toEqual({
      Email: ['The Email field is required.', "'Email' must not be empty."],
      Password: ['The Password field is required.', "'Password' must not be empty."],
      ConfirmPassword: ['The ConfirmPassword field is required.'],
      OrganizationName: ['The OrganizationName field is required.', "'Organization Name' must not be empty."],
      WebsiteUrl: ['The WebsiteUrl field is required.', "'Website Url' must not be empty."],
      AddressLine: ['The AddressLine field is required.', "'Address Line' must not be empty."],
      City: ['The City field is required.', "'City' must not be empty."],
      State: ['The State field is required.', "'State' must not be empty."],
      ZipCode: ['The ZipCode field is required.', "'Zip Code' must not be empty."],
    });
  });

  it('checks the password policy rule by rule', () => {
    const attempt = (password: string, confirmPassword = password) => errorsOf(registerSchema, { ...validRegistration, password, confirmPassword });
    expect(attempt('Strong Pass 123!')).toEqual({ Password: ['Password cannot contain spaces.'] });
    expect(attempt('ALLUPPERCASE123!')).toEqual({ Password: ['Password must include a lowercase letter.'] });
    expect(attempt('alllowercasepassword')).toEqual({
      Password: ['Password must include an uppercase letter.', 'Password must include a number.', 'Password must include a symbol.'],
    });
    expect(attempt(`Aa1!${'x'.repeat(125)}`)).toEqual({ Password: ["The length of 'Password' must be 128 characters or fewer. You entered 129 characters."] });
    expect(attempt('')).toEqual({
      Password: [
        "'Password' must not be empty.",
        "The length of 'Password' must be at least 12 characters. You entered 0 characters.",
        'Password must include a lowercase letter.',
        'Password must include an uppercase letter.',
        'Password must include a number.',
        'Password must include a symbol.',
      ],
    });
    expect(attempt('Valid-Password-123', 'Valid-Password-124')).toEqual({ ConfirmPassword: ['Passwords do not match.'] });
    expect(errorsOf(registerSchema, { ...validRegistration, confirmPassword: undefined })).toEqual({
      ConfirmPassword: ['The ConfirmPassword field is required.', 'Passwords do not match.'],
    });
  });

  it('applies the email regex on top of the basic email check', () => {
    expect(errorsOf(registerSchema, { ...validRegistration, email: 'a@b' })).toEqual({ Email: ['Enter a valid email address.'] });
    expect(errorsOf(registerSchema, { ...validRegistration, email: 'a b@example.com' })).toEqual({ Email: ['Enter a valid email address.'] });
    expect(errorsOf(registerSchema, { ...validRegistration, email: `${'a'.repeat(310)}@example.com` })).toEqual({
      Email: ["The length of 'Email' must be 320 characters or fewer. You entered 322 characters."],
    });
  });

  it('rejects values that are not JSON strings', () => {
    expect(errorsOf(registerSchema, { ...validRegistration, email: 123 })).toEqual({ Email: ['The JSON value could not be converted to System.String.'] });
  });
});

describe('loginSchema (LoginRequestValidator)', () => {
  it('matches the .NET responses for empty, missing and malformed credentials', () => {
    expect(errorsOf(loginSchema, { email: '', password: '' })).toEqual({
      Email: ["'Email' must not be empty.", "'Email' is not a valid email address.", 'Enter a valid email address.'],
      Password: ["'Password' must not be empty."],
    });
    expect(errorsOf(loginSchema, {})).toEqual({
      Email: ['The Email field is required.', "'Email' must not be empty."],
      Password: ['The Password field is required.', "'Password' must not be empty."],
    });
    expect(errorsOf(loginSchema, { email: 'a@b', password: 'x' })).toEqual({ Email: ['Enter a valid email address.'] });
    expect(errorsOf(loginSchema, { email: 'admin@deentime.test', password: 'x'.repeat(129) })).toEqual({
      Password: ["The length of 'Password' must be 128 characters or fewer. You entered 129 characters."],
    });
    expect(errorsOf(loginSchema, { email: 'admin@deentime.test', password: 'pw', captchaToken: 'x'.repeat(2049) })).toEqual({
      CaptchaToken: ["The length of 'Captcha Token' must be 2048 characters or fewer. You entered 2049 characters."],
    });
  });

  it('accepts a valid login with or without a captcha token', () => {
    expect(new ZodValidationPipe(loginSchema).transform({ email: 'Admin@DeenTime.test', password: 'secret' })).toEqual({
      email: 'Admin@DeenTime.test',
      password: 'secret',
      captchaToken: null,
    });
    expect(errorsOf(loginSchema, { email: 'admin@deentime.test', password: 'secret', captchaToken: 'token' })).toBeNull();
  });
});

describe('verifyEmailSchema (VerifyEmailRequestValidator)', () => {
  it('requires a token of at most 512 characters', () => {
    expect(errorsOf(verifyEmailSchema, {})).toEqual({ Token: ['The Token field is required.', "'Token' must not be empty."] });
    expect(errorsOf(verifyEmailSchema, { token: '' })).toEqual({ Token: ["'Token' must not be empty."] });
    expect(errorsOf(verifyEmailSchema, { token: 'x'.repeat(513) })).toEqual({ Token: ["The length of 'Token' must be 512 characters or fewer. You entered 513 characters."] });
    expect(errorsOf(verifyEmailSchema, { token: 'x'.repeat(512) })).toBeNull();
  });
});

describe('forgotSchema (ForgotRequestValidator)', () => {
  it('only applies NotEmpty and EmailAddress', () => {
    expect(errorsOf(forgotSchema, { email: 'bad' })).toEqual({ Email: ["'Email' is not a valid email address."] });
    expect(errorsOf(forgotSchema, { email: ' ' })).toEqual({ Email: ["'Email' must not be empty.", "'Email' is not a valid email address."] });
    expect(errorsOf(forgotSchema, { email: 'a@b' })).toBeNull();
    expect(errorsOf(forgotSchema, {})).toEqual({ Email: ['The Email field is required.', "'Email' must not be empty."] });
  });
});

describe('resetSchema (ResetRequestValidator)', () => {
  it('requires a token and a policy-compliant new password', () => {
    expect(errorsOf(resetSchema, { token: '', newPassword: 'abc' })).toEqual({
      Token: ["'Token' must not be empty."],
      NewPassword: [
        "The length of 'New Password' must be at least 12 characters. You entered 3 characters.",
        'Password must include an uppercase letter.',
        'Password must include a number.',
        'Password must include a symbol.',
      ],
    });
    expect(errorsOf(resetSchema, { token: 'x'.repeat(600), newPassword: 'Another-strong-password-5678' })).toBeNull();
    expect(errorsOf(resetSchema, {})).toEqual({
      Token: ['The Token field is required.', "'Token' must not be empty."],
      NewPassword: ['The NewPassword field is required.', "'New Password' must not be empty."],
    });
  });
});
