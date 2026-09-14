import { describe, expect, it } from 'vitest';
import { IslamicContentProviderError } from './errors.js';
import { IslamicContentOptions } from './islamic-content-options.js';
import { QiblaProviderClient } from './qibla-provider.client.js';

interface StubFetch {
  fetch: typeof fetch;
  requestCount: number;
  lastUrl: URL | null;
}

function stubFetch(factory: (url: URL) => Response): StubFetch {
  const stub: StubFetch = {
    requestCount: 0,
    lastUrl: null,
    fetch: async (input) => {
      stub.requestCount += 1;
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      stub.lastUrl = url;
      return factory(url);
    },
  };
  return stub;
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

function createClient(stub: StubFetch): QiblaProviderClient {
  return new QiblaProviderClient(new IslamicContentOptions(), { fetch: stub.fetch, now: () => new Date('2026-09-10T12:00:00Z') });
}

describe('QiblaProviderClient', () => {
  it('direction uses the documented path and caches stable coordinates', async () => {
    const stub = stubFetch(() => jsonResponse('{"code":200,"status":"OK","data":{"latitude":30.5052,"longitude":-97.8203,"direction":43.36991455214116}}'));
    const client = createClient(stub);

    const first = await client.getDirection(30.5052, -97.8203);
    const cached = await client.getDirection(30.5052, -97.8203);

    expect(first.fromCache).toBe(false);
    expect(cached.fromCache).toBe(true);
    expect(first.data.direction).toBeCloseTo(43.36991455214116, 10);
    expect(cached.data).toEqual(first.data);
    expect(stub.lastUrl?.pathname).toBe('/v1/qibla/30.5052/-97.8203');
    expect(stub.lastUrl?.origin).toBe('https://api.aladhan.com');
    expect(stub.requestCount).toBe(1);
  });

  it('compass requires and returns the documented png format', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const stub = stubFetch(() => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const client = createClient(stub);

    const result = await client.getCompass(19.071017570421, 72.838622286762);

    expect(result.contentType).toBe('image/png');
    expect(Buffer.from(result.content).equals(png)).toBe(true);
    expect(stub.lastUrl?.pathname).toBe('/v1/qibla/19.071018/72.838622/compass');
  });

  it('compass rejects non-png payloads', async () => {
    const stub = stubFetch(() => jsonResponse('{"code":200}'));
    const client = createClient(stub);
    await expect(client.getCompass(30.5, -97.8)).rejects.toThrow('The Qibla provider returned an unexpected compass format.');
  });

  it.each([
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])('coordinates outside the globe are rejected (%s, %s)', (latitude, longitude) => {
    expect(QiblaProviderClient.areValidCoordinates(latitude, longitude)).toBe(false);
  });

  it('invalid provider data is not forwarded to masjid clients', async () => {
    const stub = stubFetch(() => jsonResponse('{"code":200,"status":"OK","data":{"latitude":30.5,"longitude":-97.8,"direction":999}}'));
    const client = createClient(stub);

    const failure = await client.getDirection(30.5, -97.8).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IslamicContentProviderError);
    expect((failure as Error).message.toLowerCase()).toContain('invalid direction');
  });

  it('reports upstream status codes and malformed JSON with the .NET messages', async () => {
    const failing = createClient(stubFetch(() => jsonResponse('', 503)));
    await expect(failing.getDirection(30.5, -97.8)).rejects.toThrow('The Qibla provider returned HTTP 503.');

    const malformed = createClient(stubFetch(() => jsonResponse('{not json')));
    await expect(malformed.getDirection(30.5, -97.8)).rejects.toThrow('The Qibla provider returned invalid JSON.');

    const incomplete = createClient(stubFetch(() => jsonResponse('{"code":200,"data":{"latitude":30.5}}')));
    await expect(incomplete.getDirection(30.5, -97.8)).rejects.toThrow('The Qibla provider returned an incomplete response.');
  });

  it('maps transport failures to provider errors', async () => {
    const offline = createClient(
      stubFetch(() => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(offline.getDirection(30.5, -97.8)).rejects.toThrow('The Qibla provider is currently unavailable.');

    const slow = createClient(
      stubFetch(() => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }),
    );
    await expect(slow.getCompass(30.5, -97.8)).rejects.toThrow('The Qibla compass provider timed out.');
  });

  it.each([
    [30.5052, '30.5052'],
    [-97.8203, '-97.8203'],
    [19.071017570421, '19.071018'],
    [12.3456789, '12.345679'],
    [-12.3456789, '-12.345679'],
    [0.00000015, '0'],
    [-0.0000004, '0'],
    [90, '90'],
    [-180, '-180'],
  ])('formatCoordinate(%s) renders "0.######" with away-from-zero rounding', (value, expected) => {
    expect(QiblaProviderClient.formatCoordinate(value)).toBe(expected);
  });
});
