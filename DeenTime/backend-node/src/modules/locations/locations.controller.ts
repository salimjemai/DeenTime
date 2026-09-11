import { Controller, Get, Param, Query } from '@nestjs/common';
import { AllowAnonymous } from '../../common/auth/authorize.decorator.js';
import { badRequest, notFound, problem, validationProblem } from '../../common/errors.js';
import { RateLimit } from '../../common/rate-limit.js';
import { ProviderUnavailableError } from '../../integrations/errors.js';
import { GoogleAddressService, type AddressSuggestion, type VerifiedAddress } from '../../integrations/google-address.service.js';
import { PostalCodeService, type PostalCodeLocation } from '../../integrations/postal-code.service.js';

/** Port of LocationsController.cs: every action is anonymous and rate limited by the "locations" policy. */
@Controller('api/v1/locations')
@AllowAnonymous()
@RateLimit('locations')
export class LocationsController {
  constructor(
    private readonly postalCodes: PostalCodeService,
    private readonly addresses: GoogleAddressService,
  ) {}

  @Get('postal-code/:postalCode')
  @AllowAnonymous()
  async resolvePostalCode(@Param('postalCode') postalCode: string): Promise<PostalCodeLocation> {
    const normalized = PostalCodeService.normalizeUsPostalCode(postalCode);
    if (normalized === null) throw badRequest({ message: 'Enter a valid 5-digit U.S. ZIP code.' });

    let location: PostalCodeLocation | null;
    try {
      location = await this.postalCodes.resolveUs(normalized);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Postal-code lookup is temporarily unavailable.');
      throw error;
    }
    if (location === null) throw notFound({ message: 'That U.S. ZIP code could not be found.' });
    return location;
  }

  @Get('address-suggestions')
  @AllowAnonymous()
  async addressSuggestions(@Query('input') rawInput: unknown, @Query('sessionToken') rawSessionToken: unknown): Promise<AddressSuggestion[]> {
    const { input, sessionToken } = requireQuery({ input: queryValue(rawInput), sessionToken: queryValue(rawSessionToken) });
    if (!this.addresses.isEnabled) throw problem(503, 'Address autocomplete is not configured.');
    if (input.trim() === '' || input.trim().length < 4 || input.length > 240 || sessionToken.trim() === '' || sessionToken.length > 128) {
      throw badRequest({ message: 'Enter at least four address characters.' });
    }

    try {
      return await this.addresses.search(input, sessionToken);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Address lookup is temporarily unavailable.');
      throw error;
    }
  }

  @Get('address-details/:placeId')
  @AllowAnonymous()
  async addressDetails(@Param('placeId') placeId: string, @Query('sessionToken') rawSessionToken: unknown): Promise<VerifiedAddress> {
    const { sessionToken } = requireQuery({ sessionToken: queryValue(rawSessionToken) });
    if (!this.addresses.isEnabled) throw problem(503, 'Address verification is not configured.');
    if (placeId.trim() === '' || placeId.length > 512 || sessionToken.trim() === '' || sessionToken.length > 128) {
      throw badRequest({ message: 'Choose a valid address suggestion.' });
    }

    let address: VerifiedAddress | null;
    try {
      address = await this.addresses.resolve(placeId, sessionToken);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Address verification is temporarily unavailable.');
      throw error;
    }
    if (address === null) throw notFound({ message: 'That address could not be verified as a complete U.S. street address.' });
    return address;
  }
}

/** The first value of a query parameter; an empty value binds like a missing one in ASP.NET. */
function queryValue(value: unknown): string | undefined {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : undefined;
}

/**
 * Non-nullable `[FromQuery] string` parameters are implicitly [Required]: model
 * validation rejects the request before the action runs, keyed by the parameter name.
 */
function requireQuery<K extends string>(values: Record<K, string | undefined>): Record<K, string> {
  const errors: Record<string, string[]> = {};
  for (const [name, value] of Object.entries<string | undefined>(values)) {
    if (value === undefined) errors[name] = [`The ${name} field is required.`];
  }
  if (Object.keys(errors).length > 0) throw validationProblem(errors);
  return values as Record<K, string>;
}
