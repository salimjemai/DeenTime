import { describe, expect, it } from 'vitest';
import { ProblemDetailsException } from '../../common/errors.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { createInvitationSchema } from './admin-masjids.schemas.js';

function errorsOf(input: unknown): Record<string, string[]> | null {
  try {
    new ZodValidationPipe(createInvitationSchema).transform(input);
    return null;
  } catch (error) {
    if (error instanceof ProblemDetailsException) return error.problem.errors ?? {};
    throw error;
  }
}

describe('createInvitationSchema (CreateMasjidInvitationRequestValidator)', () => {
  it('requires the email and organization name only', () => {
    expect(errorsOf({})).toEqual({
      Email: ['The Email field is required.', "'Email' must not be empty."],
      OrganizationName: ['The OrganizationName field is required.', "'Organization Name' must not be empty."],
    });
    expect(new ZodValidationPipe(createInvitationSchema).transform({ email: 'Admin@Masjid.test', organizationName: ' Masjid ' })).toEqual({
      email: 'Admin@Masjid.test',
      organizationName: ' Masjid ',
      websiteUrl: null,
      addressLine: null,
      city: null,
      state: null,
      zipCode: null,
    });
  });

  it('applies the length rules with the FluentValidation messages', () => {
    expect(errorsOf({ email: `${'a'.repeat(310)}@example.com`, organizationName: 'x'.repeat(161), websiteUrl: 'x'.repeat(2049), addressLine: 'x'.repeat(241), city: 'x'.repeat(121) })).toEqual({
      Email: ["The length of 'Email' must be 320 characters or fewer. You entered 322 characters."],
      OrganizationName: ["The length of 'Organization Name' must be 160 characters or fewer. You entered 161 characters."],
      WebsiteUrl: ["The length of 'Website Url' must be 2048 characters or fewer. You entered 2049 characters."],
      AddressLine: ["The length of 'Address Line' must be 240 characters or fewer. You entered 241 characters."],
      City: ["The length of 'City' must be 120 characters or fewer. You entered 121 characters."],
    });
  });

  it('uses the basic email check without the registration regex', () => {
    expect(errorsOf({ email: 'bad', organizationName: 'Masjid' })).toEqual({ Email: ["'Email' is not a valid email address."] });
    expect(errorsOf({ email: 'a@b', organizationName: 'Masjid' })).toBeNull();
  });

  it('validates the optional state and ZIP code only when present', () => {
    expect(errorsOf({ email: 'admin@masjid.test', organizationName: 'Masjid', state: 'TXX', zipCode: '1234' })).toEqual({
      State: ['State must be a two-letter abbreviation.'],
      ZipCode: ['Enter a valid U.S. ZIP code.'],
    });
    expect(errorsOf({ email: 'admin@masjid.test', organizationName: 'Masjid', state: ' tx ', zipCode: ' 78613-1234 ' })).toBeNull();
    expect(errorsOf({ email: 'admin@masjid.test', organizationName: 'Masjid', state: '  ', zipCode: '' })).toBeNull();
    expect(errorsOf({ email: 'admin@masjid.test', organizationName: 'Masjid', state: null, zipCode: null })).toBeNull();
  });
});
