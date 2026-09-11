import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../config/configuration.js';
import { ProviderUnavailableError } from './errors.js';
import { GoogleAddressService } from './google-address.service.js';

function testConfig(overrides: Record<string, string>): AppConfig {
  return AppConfig.load({ contentRoot: tmpdir(), env: {}, overrides, environmentName: 'Testing' });
}

const enabledConfig = testConfig({ 'GooglePlaces:Enabled': 'true', 'GooglePlaces:ApiKey': 'test-key' });

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function fetchStub(handler: (url: string, init: RequestInit) => Response | Promise<Response>): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  };
  return { fetch: impl, calls };
}

function json(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

// Stub payloads from backend/DeenTime.Api.Tests/GoogleAddressResolverTests.cs.
const autocompleteJson = '{"suggestions":[{"placePrediction":{"placeId":"place-123","text":{"text":"14300 Rountree Ranch Ln, Austin, TX 78717, USA"}}}]}';
const detailsJson = `{
  "id":"place-123",
  "formattedAddress":"14300 Rountree Ranch Ln, Austin, TX 78717, USA",
  "addressComponents":[
    {"longText":"14300","shortText":"14300","types":["street_number"]},
    {"longText":"Rountree Ranch Ln","shortText":"Rountree Ranch Ln","types":["route"]},
    {"longText":"Austin","shortText":"Austin","types":["locality"]},
    {"longText":"Texas","shortText":"TX","types":["administrative_area_level_1"]},
    {"longText":"78717","shortText":"78717","types":["postal_code"]},
    {"longText":"United States","shortText":"US","types":["country"]}
  ],
  "location":{"latitude":30.5119418,"longitude":-97.8177601}
}`;

function googleStub(): ReturnType<typeof fetchStub> {
  return fetchStub((_url, init) => json(init.method === 'POST' ? autocompleteJson : detailsJson));
}

function headers(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe('GoogleAddressService', () => {
  it('search and details return a complete verified US address and the details are cached', async () => {
    const stub = googleStub();
    const service = new GoogleAddressService(enabledConfig, { fetch: stub.fetch, baseUrl: 'https://places.googleapis.test/' });

    const suggestions = await service.search('14300 Rountree', 'session-1');
    expect(suggestions).toEqual([{ placeId: 'place-123', description: '14300 Rountree Ranch Ln, Austin, TX 78717, USA' }]);

    const address = await service.resolve(suggestions[0].placeId, 'session-1');
    expect(address).toEqual({
      placeId: 'place-123',
      formattedAddress: '14300 Rountree Ranch Ln, Austin, TX 78717, USA',
      addressLine: '14300 Rountree Ranch Ln',
      city: 'Austin',
      state: 'TX',
      postalCode: '78717',
      country: 'US',
      latitude: 30.5119418,
      longitude: -97.8177601,
    });

    expect(await service.resolve(suggestions[0].placeId, null)).toBe(address);
    expect(stub.calls).toHaveLength(2);
  });

  it('sends the autocomplete request the way the .NET resolver did', async () => {
    const stub = googleStub();
    const service = new GoogleAddressService(enabledConfig, { fetch: stub.fetch, baseUrl: 'https://places.googleapis.test/' });

    await service.search('  14300 Rountree  ', 'session-1');

    const call = stub.calls[0];
    expect(call.url).toBe('https://places.googleapis.test/v1/places:autocomplete');
    expect(call.init.method).toBe('POST');
    expect(headers(call.init)).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Goog-Api-Key': 'test-key',
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
      'User-Agent': 'IqamaTime/1.0',
    });
    expect(JSON.parse(call.init.body as string)).toEqual({
      input: '14300 Rountree',
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address'],
      languageCode: 'en',
      sessionToken: 'session-1',
    });
  });

  it('sends the details request with the session token and the details field mask', async () => {
    const stub = googleStub();
    const service = new GoogleAddressService(enabledConfig, { fetch: stub.fetch, baseUrl: 'https://places.googleapis.test/' });

    await service.resolve('place/123', 'session 1');
    await service.resolve('place-456');

    expect(stub.calls[0].url).toBe('https://places.googleapis.test/v1/places/place%2F123?languageCode=en&sessionToken=session%201');
    expect(stub.calls[0].init.method).toBe('GET');
    expect(headers(stub.calls[0].init)).toMatchObject({
      'X-Goog-Api-Key': 'test-key',
      'X-Goog-FieldMask': 'id,formattedAddress,addressComponents,location',
      'User-Agent': 'IqamaTime/1.0',
    });
    expect(stub.calls[1].url).toBe('https://places.googleapis.test/v1/places/place-456?languageCode=en');
  });

  it('re-fetches a place after the 20 minute cache window', async () => {
    let current = new Date('2026-09-10T12:00:00Z');
    const stub = googleStub();
    const service = new GoogleAddressService(enabledConfig, { fetch: stub.fetch, baseUrl: 'https://places.googleapis.test/', now: () => current });

    const first = await service.resolve('place-123', null);
    current = new Date('2026-09-10T12:19:59Z');
    expect(await service.resolve('place-123', null)).toBe(first);
    current = new Date('2026-09-10T12:20:01Z');
    const third = await service.resolve('place-123', null);

    expect(third).not.toBe(first);
    expect(third).toEqual(first);
    expect(stub.calls).toHaveLength(2);
  });

  it('is disabled without Enabled and ApiKey and then never calls the network', async () => {
    const stub = googleStub();
    const disabled = new GoogleAddressService(testConfig({ 'GooglePlaces:Enabled': 'false', 'GooglePlaces:ApiKey': 'k' }), { fetch: stub.fetch });
    expect(disabled.isEnabled).toBe(false);
    expect(await disabled.search('14300 Rountree', 's')).toEqual([]);
    expect(await disabled.resolve('place-123', 's')).toBeNull();
    expect(stub.calls).toHaveLength(0);
  });

  it('fails at construction when enabled without an API key (ValidateOnStart)', () => {
    expect(() => new GoogleAddressService(testConfig({ 'GooglePlaces:Enabled': 'true' }))).toThrow(
      'Google Places API key is required when address autocomplete is enabled.',
    );
  });

  it('returns no suggestions for inputs shorter than four characters', async () => {
    const stub = googleStub();
    const service = new GoogleAddressService(enabledConfig, { fetch: stub.fetch });
    expect(await service.search(' 143 ', 's')).toEqual([]);
    expect(await service.search('', 's')).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('takes at most five predictions and skips incomplete ones', async () => {
    const predictions = Array.from({ length: 7 }, (_, index) => ({ placePrediction: { placeId: `p${index}`, text: { text: `Address ${index}` } } }));
    predictions.splice(1, 0, { placePrediction: { placeId: '', text: { text: 'blank id' } } });
    const stub = fetchStub(() => json(JSON.stringify({ suggestions: [...predictions, { placePrediction: null }] })));
    const service = new GoogleAddressService(enabledConfig, { fetch: stub.fetch });
    const suggestions = await service.search('14300 Rountree', 's');
    expect(suggestions.map((item) => item.placeId)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('returns null for an unknown place (404), a non-US address or an incomplete address', async () => {
    const notFound = fetchStub(() => new Response(null, { status: 404 }));
    expect(await new GoogleAddressService(enabledConfig, { fetch: notFound.fetch }).resolve('missing', null)).toBeNull();

    const canada = fetchStub(() => json(detailsJson.replace('"shortText":"US"', '"shortText":"CA"')));
    expect(await new GoogleAddressService(enabledConfig, { fetch: canada.fetch }).resolve('place-123', null)).toBeNull();

    const noStreetNumber = fetchStub(() => json(detailsJson.replace('"types":["street_number"]', '"types":["premise"]')));
    expect(await new GoogleAddressService(enabledConfig, { fetch: noStreetNumber.fetch }).resolve('place-123', null)).toBeNull();

    const noLocation = fetchStub(() => json(detailsJson.replace(/,\s*"location":\{[^}]*\}/, '')));
    expect(await new GoogleAddressService(enabledConfig, { fetch: noLocation.fetch }).resolve('place-123', null)).toBeNull();
  });

  it('appends the subpremise and falls back through the city component types', async () => {
    const body = detailsJson
      .replace('"types":["locality"]', '"types":["sublocality_level_1"]')
      .replace('"addressComponents":[', '"addressComponents":[{"longText":"4B","shortText":"4B","types":["subpremise"]},');
    const stub = fetchStub(() => json(body));
    const address = await new GoogleAddressService(enabledConfig, { fetch: stub.fetch }).resolve('place-123', null);
    expect(address?.addressLine).toBe('14300 Rountree Ranch Ln #4B');
    expect(address?.city).toBe('Austin');
  });

  it('throws ProviderUnavailableError on other failures', async () => {
    const serverError = fetchStub(() => new Response('nope', { status: 500 }));
    const service = new GoogleAddressService(enabledConfig, { fetch: serverError.fetch });
    await expect(service.search('14300 Rountree', 's')).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(service.resolve('place-123', null)).rejects.toBeInstanceOf(ProviderUnavailableError);

    const searchNotFound = fetchStub(() => new Response(null, { status: 404 }));
    await expect(new GoogleAddressService(enabledConfig, { fetch: searchNotFound.fetch }).search('14300 Rountree', 's')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    const offline = fetchStub(() => {
      throw new TypeError('fetch failed');
    });
    await expect(new GoogleAddressService(enabledConfig, { fetch: offline.fetch }).resolve('place-123', null)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
