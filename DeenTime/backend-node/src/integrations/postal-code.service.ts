import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../config/configuration.js';
import { ProviderHttpClient, type ProviderClientOptions } from './http-client.js';

/** Port of PostalCodeResolver.PostalCodeLocation. */
export interface PostalCodeLocation {
  postalCode: string;
  city: string;
  state: string;
  stateAbbreviation: string;
  country: string;
  latitude: number;
  longitude: number;
}

/** Optional DI token for ProviderClientOptions (never registered in production; tests may provide stubs). */
export const POSTAL_CODE_CLIENT_OPTIONS = Symbol('POSTAL_CODE_CLIENT_OPTIONS');

const US_POSTAL_CODE_PATTERN = /^(\d{5})(?:-\d{4})?$/;
/** decimal.TryParse with NumberStyles.Float and the invariant culture. */
const DECIMAL_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const postalCodeResponse = z.object({
  'post code': z.string(),
  country: z.string(),
  places: z.array(
    z.object({
      'place name': z.string(),
      state: z.string(),
      'state abbreviation': z.string(),
      latitude: z.string(),
      longitude: z.string(),
    }),
  ),
});

/**
 * Port of PostalCodeResolver: ZIP → city/state/coordinates through api.zippopotam.us
 * (10 s timeout, User-Agent IqamaTime/1.0) with a process-wide cache that never expires.
 */
@Injectable()
export class PostalCodeService {
  static readonly DEFAULT_BASE_URL = 'https://api.zippopotam.us/';

  private readonly http: ProviderHttpClient;
  private readonly cache = new Map<string, PostalCodeLocation>();

  // The .NET resolver has no configuration of its own; AppConfig is accepted so every
  // integration is constructed the same way.
  constructor(_config: AppConfig, @Optional() @Inject(POSTAL_CODE_CLIENT_OPTIONS) options: ProviderClientOptions = {}) {
    this.http = new ProviderHttpClient(
      'Postal code lookup',
      { baseUrl: PostalCodeService.DEFAULT_BASE_URL, timeoutMs: 10_000, userAgent: 'IqamaTime/1.0' },
      options,
    );
  }

  /** "78613", "78613-1234" or " 78613 " → "78613"; anything else → null. */
  static normalizeUsPostalCode(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value.trim() === '') return null;
    const match = US_POSTAL_CODE_PATTERN.exec(value.trim());
    return match === null ? null : match[1];
  }

  /** Resolves a US ZIP; null when the input is invalid or unknown (404). Other failures throw ProviderUnavailableError. */
  async resolveUs(postalCode: string): Promise<PostalCodeLocation | null> {
    const normalized = PostalCodeService.normalizeUsPostalCode(postalCode);
    if (normalized === null) return null;
    const cached = this.cache.get(normalized);
    if (cached !== undefined) return cached;

    const response = await this.http.send(`us/${encodeURIComponent(normalized)}`, { method: 'GET' });
    if (response.status === 404) return null;
    this.http.ensureSuccess(response);

    const parsed = postalCodeResponse.safeParse(await this.http.readJson(response));
    if (!parsed.success) return null;
    const place = parsed.data.places.at(0);
    if (place === undefined) return null;
    const latitude = parseDecimal(place.latitude);
    const longitude = parseDecimal(place.longitude);
    if (latitude === null || longitude === null) return null;

    const location: PostalCodeLocation = {
      postalCode: parsed.data['post code'],
      city: place['place name'],
      state: place.state,
      stateAbbreviation: place['state abbreviation'],
      country: parsed.data.country,
      latitude,
      longitude,
    };
    this.cache.set(normalized, location);
    return location;
  }
}

function parseDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
