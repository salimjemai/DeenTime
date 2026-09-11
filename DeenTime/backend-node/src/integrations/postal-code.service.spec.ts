import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../config/configuration.js';
import { ProviderUnavailableError } from './errors.js';
import { PostalCodeService } from './postal-code.service.js';

const config = AppConfig.load({ contentRoot: tmpdir(), env: {}, environmentName: 'Testing' });

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

const zippopotam = {
  'post code': '78613',
  country: 'United States',
  'country abbreviation': 'US',
  places: [{ 'place name': 'Cedar Park', longitude: '-97.8203', state: 'Texas', 'state abbreviation': 'TX', latitude: '30.5052' }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('PostalCodeService.normalizeUsPostalCode', () => {
  it.each([
    ['78613', '78613'],
    ['78613-1234', '78613'],
    [' 78613 ', '78613'],
    ['Cedar Park', null],
    ['7861', null],
    ['786131', null],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
  ])('normalizes %j to %j', (input, expected) => {
    expect(PostalCodeService.normalizeUsPostalCode(input)).toBe(expected);
  });
});

describe('PostalCodeService.resolveUs', () => {
  it('requests {baseUrl}us/{zip} with the IqamaTime User-Agent and keeps the negative longitude', async () => {
    const stub = fetchStub(() => json(zippopotam));
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test/' });

    const location = await service.resolveUs('78613-1234');

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe('https://postal.test/us/78613');
    expect(stub.calls[0].init.method).toBe('GET');
    expect((stub.calls[0].init.headers as Record<string, string>)['User-Agent']).toBe('IqamaTime/1.0');
    expect(stub.calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(location).toEqual({
      postalCode: '78613',
      city: 'Cedar Park',
      state: 'Texas',
      stateAbbreviation: 'TX',
      country: 'United States',
      latitude: 30.5052,
      longitude: -97.8203,
    });
  });

  it('accepts a base URL without a trailing slash', async () => {
    const stub = fetchStub(() => json(zippopotam));
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test' });
    await service.resolveUs('78613');
    expect(stub.calls[0].url).toBe('https://postal.test/us/78613');
  });

  it('caches resolved locations by normalized ZIP without expiry', async () => {
    const stub = fetchStub(() => json(zippopotam));
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test/' });

    const first = await service.resolveUs('78613');
    const second = await service.resolveUs(' 78613-0001 ');

    expect(second).toBe(first);
    expect(stub.calls).toHaveLength(1);
  });

  it('returns null without calling the provider for an invalid ZIP', async () => {
    const stub = fetchStub(() => json(zippopotam));
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test/' });
    expect(await service.resolveUs('Cedar Park')).toBeNull();
    expect(stub.calls).toHaveLength(0);
  });

  it('returns null for an unknown ZIP (404) and does not cache it', async () => {
    const stub = fetchStub(() => new Response(null, { status: 404 }));
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test/' });
    expect(await service.resolveUs('99999')).toBeNull();
    expect(await service.resolveUs('99999')).toBeNull();
    expect(stub.calls).toHaveLength(2);
  });

  it('returns null when the provider has no places or unparsable coordinates', async () => {
    const empty = fetchStub(() => json({ ...zippopotam, places: [] }));
    expect(await new PostalCodeService(config, { fetch: empty.fetch, baseUrl: 'https://postal.test/' }).resolveUs('78613')).toBeNull();

    const broken = fetchStub(() => json({ ...zippopotam, places: [{ ...zippopotam.places[0], latitude: 'north' }] }));
    expect(await new PostalCodeService(config, { fetch: broken.fetch, baseUrl: 'https://postal.test/' }).resolveUs('78613')).toBeNull();
  });

  it('throws ProviderUnavailableError for other non-2xx responses', async () => {
    const stub = fetchStub(() => new Response('upstream down', { status: 502 }));
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test/' });
    await expect(service.resolveUs('78613')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('throws ProviderUnavailableError when the network call fails', async () => {
    const stub = fetchStub(() => {
      throw new TypeError('fetch failed');
    });
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test/' });
    await expect(service.resolveUs('78613')).rejects.toMatchObject({ name: 'ProviderUnavailableError', provider: 'Postal code lookup' });
  });

  it('throws ProviderUnavailableError when the body is not JSON', async () => {
    const stub = fetchStub(() => new Response('<html>', { status: 200 }));
    const service = new PostalCodeService(config, { fetch: stub.fetch, baseUrl: 'https://postal.test/' });
    await expect(service.resolveUs('78613')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
