import { config, type App } from '../core/context.js';
import { badRequest, notFound, problem, validationProblem } from '../core/errors.js';
import { rateLimit } from '../core/rate-limit.js';
import { ProviderUnavailableError } from '../integrations/errors.js';
import { googleAddressService, type AddressSuggestion, type VerifiedAddress } from '../integrations/google-address.js';
import { PostalCodeService, postalCodeService, type PostalCodeLocation } from '../integrations/postal-code.js';

/**
 * /api/v1/locations: postal code lookup and address suggestions.
 * Port of backend-node/src/modules/locations/locations.controller.ts: every action is
 * anonymous and rate limited by the "locations" policy.
 */
export function register(app: App): void {
  app.get('/api/v1/locations/postal-code/:postalCode', rateLimit('locations'), async (c) => {
    const normalized = PostalCodeService.normalizeUsPostalCode(c.req.param('postalCode'));
    if (normalized === null) throw badRequest({ message: 'Enter a valid 5-digit U.S. ZIP code.' });

    let location: PostalCodeLocation | null;
    try {
      location = await postalCodeService(config(c)).resolveUs(normalized);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Postal-code lookup is temporarily unavailable.');
      throw error;
    }
    if (location === null) throw notFound({ message: 'That U.S. ZIP code could not be found.' });
    return c.json(location);
  });

  app.get('/api/v1/locations/address-suggestions', rateLimit('locations'), async (c) => {
    const { input, sessionToken } = requireQuery({ input: queryValue(c.req.query('input')), sessionToken: queryValue(c.req.query('sessionToken')) });
    const addresses = googleAddressService(config(c));
    if (!addresses.isEnabled) throw problem(503, 'Address autocomplete is not configured.');
    if (input.trim() === '' || input.trim().length < 4 || input.length > 240 || sessionToken.trim() === '' || sessionToken.length > 128) {
      throw badRequest({ message: 'Enter at least four address characters.' });
    }

    let suggestions: AddressSuggestion[];
    try {
      suggestions = await addresses.search(input, sessionToken);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Address lookup is temporarily unavailable.');
      throw error;
    }
    return c.json(suggestions);
  });

  app.get('/api/v1/locations/address-details/:placeId', rateLimit('locations'), async (c) => {
    const placeId = c.req.param('placeId');
    const { sessionToken } = requireQuery({ sessionToken: queryValue(c.req.query('sessionToken')) });
    const addresses = googleAddressService(config(c));
    if (!addresses.isEnabled) throw problem(503, 'Address verification is not configured.');
    if (placeId.trim() === '' || placeId.length > 512 || sessionToken.trim() === '' || sessionToken.length > 128) {
      throw badRequest({ message: 'Choose a valid address suggestion.' });
    }

    let address: VerifiedAddress | null;
    try {
      address = await addresses.resolve(placeId, sessionToken);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Address verification is temporarily unavailable.');
      throw error;
    }
    if (address === null) throw notFound({ message: 'That address could not be verified as a complete U.S. street address.' });
    return c.json(address);
  });
}

/** The first value of a query parameter; an empty value binds like a missing one in ASP.NET. */
function queryValue(value: string | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
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
