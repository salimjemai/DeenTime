import { z } from 'zod';
import { US_ZIP_PATTERN, emailAddress, maximumLength, must, notEmpty, optionalString, requiredString } from '../auth/validation-rules.js';

/** CreateMasjidInvitationRequest + CreateMasjidInvitationRequestValidator. */
export const createInvitationSchema = z.object({
  email: requiredString('Email', notEmpty(), emailAddress(), maximumLength(320)),
  organizationName: requiredString('OrganizationName', notEmpty(), maximumLength(160)),
  websiteUrl: optionalString('WebsiteUrl', maximumLength(2048)),
  addressLine: optionalString('AddressLine', maximumLength(240)),
  city: optionalString('City', maximumLength(120)),
  state: optionalString(
    'State',
    must((value) => value === null || value.trim() === '' || value.trim().length === 2, 'State must be a two-letter abbreviation.'),
  ),
  zipCode: optionalString(
    'ZipCode',
    must((value) => value === null || value.trim() === '' || US_ZIP_PATTERN.test(value.trim()), 'Enter a valid U.S. ZIP code.'),
  ),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationSchema>;
