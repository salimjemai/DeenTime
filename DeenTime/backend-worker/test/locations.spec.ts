import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { servicesFor } from '../src/core/context.js';
import { resetGoogleAddressService } from '../src/integrations/google-address.js';
import { resetPostalCodeService } from '../src/integrations/postal-code.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const zippopotam = {
  'post code': '78613',
  country: 'United States',
  'country abbreviation': 'US',
  places: [{ 'place name': 'Cedar Park', longitude: '-97.8203', state: 'Texas', 'state abbreviation': 'TX', latitude: '30.5052' }],
};

const autocomplete = {
  suggestions: [
    { placePrediction: { placeId: 'place-123', text: { text: '14300 Rountree Ranch Ln, Austin, TX 78717, USA' } } },
    { placePrediction: { placeId: '', text: { text: 'ignored' } } },
  ],
};

const details = {
  id: 'place-123',
  formattedAddress: '14300 Rountree Ranch Ln, Austin, TX 78717, USA',
  addressComponents: [
    { longText: '14300', shortText: '14300', types: ['street_number'] },
    { longText: 'Rountree Ranch Ln', shortText: 'Rountree Ranch Ln', types: ['route'] },
    { longText: 'Austin', shortText: 'Austin', types: ['locality', 'political'] },
    { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1', 'political'] },
    { longText: '78717', shortText: '78717', types: ['postal_code'] },
    { longText: 'United States', shortText: 'US', types: ['country', 'political'] },
  ],
  location: { latitude: 30.4901, longitude: -97.7603 },
};

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

/** Replaces the network: every outbound request is answered by `handler` and recorded. */
function stubFetch(handler: (url: string) => Response): { calls: Call[] } {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : null });
    return handler(url);
  });
  return { calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('locations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/v1/locations/postal-code/:postalCode', () => {
    let app: TestApp;
    beforeAll(async () => {
      app = await createTestApp();
    });
    beforeEach(async () => {
      await app.reset();
      resetPostalCodeService(servicesFor(app.env).config);
    });

    it('resolves a ZIP anonymously and caches it', async () => {
      const { calls } = stubFetch(() => json(zippopotam));
      const response = await app.request('GET', '/api/v1/locations/postal-code/78613');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.text()).toBe(
        JSON.stringify({ postalCode: '78613', city: 'Cedar Park', state: 'Texas', stateAbbreviation: 'TX', country: 'United States', latitude: 30.5052, longitude: -97.8203 }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.zippopotam.us/us/78613');
      expect(calls[0].headers.get('user-agent')).toBe('IqamaTime/1.0');

      // ZIP+4 normalizes to the same five digits and is served from the cache.
      const again = await app.request('GET', '/api/v1/locations/postal-code/78613-1234');
      expect(again.status).toBe(200);
      expect(calls).toHaveLength(1);
    });

    it('is 400 for something that is not a U.S. ZIP, without calling the provider', async () => {
      const { calls } = stubFetch(() => json(zippopotam));
      for (const value of ['abc', '1234', '123456', 'K1A0B1']) {
        const response = await app.request('GET', `/api/v1/locations/postal-code/${value}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ message: 'Enter a valid 5-digit U.S. ZIP code.' });
      }
      expect(calls).toHaveLength(0);
    });

    it('is 404 when the provider does not know the ZIP or answers with unusable data', async () => {
      stubFetch(() => new Response(null, { status: 404 }));
      const unknown = await app.request('GET', '/api/v1/locations/postal-code/99999');
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ message: 'That U.S. ZIP code could not be found.' });

      vi.restoreAllMocks();
      stubFetch(() => json({ 'post code': '99998', country: 'United States', places: [] }));
      expect((await app.request('GET', '/api/v1/locations/postal-code/99998')).status).toBe(404);
    });

    it('is 503 when the provider fails, cannot be reached or returns an unreadable body', async () => {
      const expected = { type: 'https://tools.ietf.org/html/rfc9110#section-15.6.4', title: 'Postal-code lookup is temporarily unavailable.', status: 503 };
      stubFetch(() => new Response('down', { status: 500 }));
      const failed = await app.request('GET', '/api/v1/locations/postal-code/78613');
      expect(failed.status).toBe(503);
      const body = (await failed.json()) as Record<string, unknown>;
      expect(body).toMatchObject(expected);
      expect(body.detail).toBeUndefined();

      vi.restoreAllMocks();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
      expect((await app.request('GET', '/api/v1/locations/postal-code/78613')).status).toBe(503);

      vi.restoreAllMocks();
      stubFetch(() => new Response('<html>', { status: 200 }));
      expect((await app.request('GET', '/api/v1/locations/postal-code/78613')).status).toBe(503);
    });

    it('allows 45 requests a minute per client address, then answers 429 with an empty body', async () => {
      stubFetch(() => json(zippopotam));
      for (let i = 0; i < 45; i += 1) {
        expect((await app.request('GET', '/api/v1/locations/postal-code/78613')).status).toBe(200);
      }
      const limited = await app.request('GET', '/api/v1/locations/postal-code/78613');
      expect(limited.status).toBe(429);
      expect(await limited.text()).toBe('');
      // The policy is shared by the three routes and partitioned by client address.
      expect((await app.request('GET', '/api/v1/locations/address-suggestions?input=14300+Rountree&sessionToken=s')).status).toBe(429);
      expect((await app.request('GET', '/api/v1/locations/postal-code/78613', { headers: { 'CF-Connecting-IP': '203.0.113.99' } })).status).toBe(200);
    });
  });

  describe('address routes when Google Places is not configured', () => {
    let app: TestApp;
    beforeAll(async () => {
      app = await createTestApp();
    });
    beforeEach(async () => {
      await app.reset();
    });

    it('reports missing query parameters before the configuration', async () => {
      const response = await app.request('GET', '/api/v1/locations/address-suggestions?input=');
      expect(response.status).toBe(400);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { input: ['The input field is required.'], sessionToken: ['The sessionToken field is required.'] },
      });

      const detailsResponse = await app.request('GET', '/api/v1/locations/address-details/place-123');
      expect(detailsResponse.status).toBe(400);
      expect(((await detailsResponse.json()) as { errors: unknown }).errors).toEqual({ sessionToken: ['The sessionToken field is required.'] });
    });

    it('is 503 without calling Google', async () => {
      const { calls } = stubFetch(() => json(autocomplete));
      const suggestions = await app.request('GET', '/api/v1/locations/address-suggestions?input=14300+Rountree&sessionToken=session-1');
      expect(suggestions.status).toBe(503);
      expect(await suggestions.json()).toMatchObject({ title: 'Address autocomplete is not configured.', status: 503 });

      const detailsResponse = await app.request('GET', '/api/v1/locations/address-details/place-123?sessionToken=session-1');
      expect(detailsResponse.status).toBe(503);
      expect(await detailsResponse.json()).toMatchObject({ title: 'Address verification is not configured.', status: 503 });
      expect(calls).toHaveLength(0);
    });
  });

  describe('address routes with Google Places enabled', () => {
    let app: TestApp;
    beforeAll(async () => {
      app = await createTestApp({ settings: { GooglePlaces__Enabled: 'true', GooglePlaces__ApiKey: 'test-key' } });
    });
    beforeEach(async () => {
      await app.reset();
      resetGoogleAddressService(servicesFor(app.env).config);
    });

    it('returns the suggestions Google predicts', async () => {
      const { calls } = stubFetch(() => json(autocomplete));
      const response = await app.request('GET', '/api/v1/locations/address-suggestions?input=%2014300%20Rountree%20&sessionToken=session-1');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([{ placeId: 'place-123', description: '14300 Rountree Ranch Ln, Austin, TX 78717, USA' }]);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://places.googleapis.com/v1/places:autocomplete');
      expect(calls[0].method).toBe('POST');
      expect(calls[0].headers.get('x-goog-api-key')).toBe('test-key');
      expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
        input: '14300 Rountree',
        includedRegionCodes: ['us'],
        includedPrimaryTypes: ['street_address'],
        languageCode: 'en',
        sessionToken: 'session-1',
      });
    });

    it('rejects short or oversized input and tokens', async () => {
      const { calls } = stubFetch(() => json(autocomplete));
      const paths = [
        '/api/v1/locations/address-suggestions?input=143&sessionToken=s',
        '/api/v1/locations/address-suggestions?input=%20%20143%20%20&sessionToken=s',
        `/api/v1/locations/address-suggestions?input=${'a'.repeat(241)}&sessionToken=s`,
        '/api/v1/locations/address-suggestions?input=14300+Rountree&sessionToken=%20',
        `/api/v1/locations/address-suggestions?input=14300+Rountree&sessionToken=${'s'.repeat(129)}`,
      ];
      for (const path of paths) {
        const response = await app.request('GET', path);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ message: 'Enter at least four address characters.' });
      }
      expect(calls).toHaveLength(0);
    });

    it('is 503 when the autocomplete request fails', async () => {
      stubFetch(() => new Response('denied', { status: 403 }));
      const response = await app.request('GET', '/api/v1/locations/address-suggestions?input=14300+Rountree&sessionToken=s');
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ title: 'Address lookup is temporarily unavailable.', status: 503 });
    });

    it('verifies a place and caches it', async () => {
      const { calls } = stubFetch(() => json(details));
      const response = await app.request('GET', '/api/v1/locations/address-details/place-123?sessionToken=session%201');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        JSON.stringify({
          placeId: 'place-123',
          formattedAddress: '14300 Rountree Ranch Ln, Austin, TX 78717, USA',
          addressLine: '14300 Rountree Ranch Ln',
          city: 'Austin',
          state: 'TX',
          postalCode: '78717',
          country: 'US',
          latitude: 30.4901,
          longitude: -97.7603,
        }),
      );
      expect(calls[0].url).toBe('https://places.googleapis.com/v1/places/place-123?languageCode=en&sessionToken=session%201');
      expect(calls[0].headers.get('x-goog-fieldmask')).toBe('id,formattedAddress,addressComponents,location');

      expect((await app.request('GET', '/api/v1/locations/address-details/place-123?sessionToken=other')).status).toBe(200);
      expect(calls).toHaveLength(1);
    });

    it('is 404 for an unknown, foreign or incomplete address', async () => {
      const message = { message: 'That address could not be verified as a complete U.S. street address.' };
      stubFetch(() => new Response(null, { status: 404 }));
      const unknown = await app.request('GET', '/api/v1/locations/address-details/missing?sessionToken=s');
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual(message);

      vi.restoreAllMocks();
      stubFetch(() => json({ ...details, addressComponents: details.addressComponents.filter((item) => !item.types.includes('street_number')) }));
      const incomplete = await app.request('GET', '/api/v1/locations/address-details/no-number?sessionToken=s');
      expect(incomplete.status).toBe(404);
      expect(await incomplete.json()).toEqual(message);

      vi.restoreAllMocks();
      stubFetch(() => json({ ...details, addressComponents: details.addressComponents.map((item) => (item.types.includes('country') ? { ...item, shortText: 'CA' } : item)) }));
      expect((await app.request('GET', '/api/v1/locations/address-details/canada?sessionToken=s')).status).toBe(404);
    });

    it('is 400 for an oversized place id or token and 503 when Google fails', async () => {
      const { calls } = stubFetch(() => new Response('down', { status: 500 }));
      for (const path of [`/api/v1/locations/address-details/${'p'.repeat(513)}?sessionToken=s`, `/api/v1/locations/address-details/place-123?sessionToken=${'s'.repeat(129)}`]) {
        const response = await app.request('GET', path);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ message: 'Choose a valid address suggestion.' });
      }
      expect(calls).toHaveLength(0);

      const failed = await app.request('GET', '/api/v1/locations/address-details/place-123?sessionToken=s');
      expect(failed.status).toBe(503);
      expect(await failed.json()).toMatchObject({ title: 'Address verification is temporarily unavailable.', status: 503 });
    });
  });
});
