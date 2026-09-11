import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../config/configuration.js';
import { ProviderHttpClient, type ProviderClientOptions } from './http-client.js';

/** Port of GoogleAddressResolver.AddressSuggestion. */
export interface AddressSuggestion {
  placeId: string;
  description: string;
}

/** Port of GoogleAddressResolver.VerifiedAddress. */
export interface VerifiedAddress {
  placeId: string;
  formattedAddress: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
}

/** Optional DI token for ProviderClientOptions (never registered in production; tests may provide stubs). */
export const GOOGLE_PLACES_CLIENT_OPTIONS = Symbol('GOOGLE_PLACES_CLIENT_OPTIONS');

const PLACE_CACHE_TTL_MS = 20 * 60_000;
const MAX_SUGGESTIONS = 5;
const AUTOCOMPLETE_FIELD_MASK = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text';
const DETAILS_FIELD_MASK = 'id,formattedAddress,addressComponents,location';

const autocompleteResponse = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string().nullish(),
            text: z.object({ text: z.string().nullish() }).nullish(),
          })
          .nullish(),
      }),
    )
    .nullish(),
});

const addressComponent = z.object({
  longText: z.string().nullish(),
  shortText: z.string().nullish(),
  types: z.array(z.string()).nullish(),
});

const placeDetailsResponse = z.object({
  id: z.string().nullish(),
  formattedAddress: z.string().nullish(),
  addressComponents: z.array(addressComponent).nullish(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
});

type AddressComponent = z.infer<typeof addressComponent>;

interface CachedAddress {
  value: VerifiedAddress;
  expiresAt: number;
}

/**
 * Port of GoogleAddressResolver: Places API (New) autocomplete restricted to US street
 * addresses plus place details verification, with resolved places cached for 20 minutes.
 * Options: GooglePlaces:Enabled, GooglePlaces:ApiKey.
 */
@Injectable()
export class GoogleAddressService {
  static readonly DEFAULT_BASE_URL = 'https://places.googleapis.com/';

  private readonly enabled: boolean;
  private readonly apiKey: string;
  private readonly http: ProviderHttpClient;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CachedAddress>();

  constructor(config: AppConfig, @Optional() @Inject(GOOGLE_PLACES_CLIENT_OPTIONS) options: ProviderClientOptions = {}) {
    this.enabled = config.getBoolean('GooglePlaces:Enabled');
    this.apiKey = config.get('GooglePlaces:ApiKey') ?? '';
    if (this.enabled && this.apiKey.trim() === '') {
      // AddOptions<GooglePlacesOptions>().Validate(...).ValidateOnStart() in Program.cs.
      throw new Error('Google Places API key is required when address autocomplete is enabled.');
    }
    this.http = new ProviderHttpClient(
      'Google Places',
      { baseUrl: GoogleAddressService.DEFAULT_BASE_URL, timeoutMs: 10_000, userAgent: 'IqamaTime/1.0' },
      options,
    );
    this.now = options.now ?? (() => new Date());
  }

  get isEnabled(): boolean {
    return this.enabled && this.apiKey.trim() !== '';
  }

  /** Up to five US street-address predictions; empty when disabled or the input is shorter than 4 characters. */
  async search(input: string, sessionToken: string): Promise<AddressSuggestion[]> {
    const trimmed = input.trim();
    if (!this.isEnabled || trimmed.length < 4) return [];

    const response = await this.http.send('v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...this.googleHeaders(AUTOCOMPLETE_FIELD_MASK) },
      body: JSON.stringify({
        input: trimmed,
        includedRegionCodes: ['us'],
        includedPrimaryTypes: ['street_address'],
        languageCode: 'en',
        sessionToken,
      }),
    });
    this.http.ensureSuccess(response);

    const parsed = autocompleteResponse.safeParse(await this.http.readJson(response));
    if (!parsed.success) return [];
    const suggestions: AddressSuggestion[] = [];
    for (const suggestion of parsed.data.suggestions ?? []) {
      const prediction = suggestion.placePrediction;
      if (!prediction || !present(prediction.placeId) || !present(prediction.text?.text)) continue;
      suggestions.push({ placeId: prediction.placeId, description: prediction.text.text });
      if (suggestions.length === MAX_SUGGESTIONS) break;
    }
    return suggestions;
  }

  /** Verifies a prediction; null when disabled, unknown (404), outside the US or incomplete. */
  async resolve(placeId: string, sessionToken?: string | null): Promise<VerifiedAddress | null> {
    if (!this.isEnabled || placeId.trim() === '') return null;
    const cacheKey = `google-place:${placeId}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      if (cached.expiresAt > this.now().getTime()) return cached.value;
      this.cache.delete(cacheKey);
    }

    let path = `v1/places/${encodeURIComponent(placeId)}?languageCode=en`;
    if (present(sessionToken)) path += `&sessionToken=${encodeURIComponent(sessionToken)}`;
    const response = await this.http.send(path, { method: 'GET', headers: this.googleHeaders(DETAILS_FIELD_MASK) });
    if (response.status === 404) return null;
    this.http.ensureSuccess(response);

    const parsed = placeDetailsResponse.safeParse(await this.http.readJson(response));
    if (!parsed.success) return null;
    const place = parsed.data;
    const components = place.addressComponents ?? [];
    const component = (type: string): AddressComponent | undefined => components.find((item) => (item.types ?? []).includes(type));
    if (component('country')?.shortText?.toUpperCase() !== 'US') return null;

    const streetNumber = component('street_number')?.longText;
    const route = component('route')?.longText;
    const subpremise = component('subpremise')?.longText;
    const city =
      component('locality')?.longText ??
      component('postal_town')?.longText ??
      component('sublocality_level_1')?.longText ??
      component('administrative_area_level_2')?.longText;
    const state = component('administrative_area_level_1')?.shortText;
    const postalCode = component('postal_code')?.longText;
    if (!present(streetNumber) || !present(route) || !present(city) || !present(state) || !present(postalCode) || !place.location) {
      return null;
    }

    let addressLine = `${streetNumber} ${route}`;
    if (present(subpremise)) addressLine += ` #${subpremise}`;

    const verified: VerifiedAddress = {
      placeId: place.id ?? placeId,
      formattedAddress: place.formattedAddress ?? '',
      addressLine,
      city,
      state,
      postalCode,
      country: 'US',
      latitude: place.location.latitude,
      longitude: place.location.longitude,
    };
    this.cache.set(cacheKey, { value: verified, expiresAt: this.now().getTime() + PLACE_CACHE_TTL_MS });
    return verified;
  }

  private googleHeaders(fieldMask: string): Record<string, string> {
    return { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': fieldMask };
  }
}

/** !string.IsNullOrWhiteSpace(value). */
function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
