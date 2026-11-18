import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Db, type SqlParam } from '../../core/db.js';
import { ArgumentError, IslamicContentProviderError } from './errors.js';
import { IslamicContentOptions } from './islamic-content-options.js';
import {
  MAX_CACHEABLE_PAYLOAD_BYTES,
  QuranProviderClient,
  canonicalizeQuranRequest,
  normalizeQuranPath,
  normalizeQuranQuery,
  utf8ByteLength,
} from './quran-provider.client.js';

interface CacheRow {
  cacheKey: string;
  /** The stored provider text. */
  payloadJson: string;
  contentType: string;
  retrievedAtUtc: Date;
  expiresAtUtc: Date;
  payloadBytes: number;
}

/** The D1 helper, counting cache lookups. */
class CountingDb extends Db {
  lookups = 0;

  override async first<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Promise<T | null> {
    this.lookups += 1;
    return super.first<T>(sql, ...params);
  }
}

const d1 = (env as unknown as { DB: D1Database }).DB;

async function seedCache(...rows: CacheRow[]): Promise<CountingDb> {
  const db = new CountingDb(d1);
  for (const [index, row] of rows.entries()) {
    await db.run(
      'INSERT INTO "IslamicContentCacheEntries" ("Id", "Provider", "CacheKey", "PayloadJson", "ContentType", "RetrievedAtUtc", "ExpiresAtUtc", "PayloadBytes") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      `00000000-0000-0000-0000-00000000000${index + 1}`,
      'alquran-cloud',
      row.cacheKey,
      row.payloadJson,
      row.contentType,
      row.retrievedAtUtc,
      row.expiresAtUtc,
      row.payloadBytes,
    );
  }
  return db;
}

async function storedRows(db: Db): Promise<Map<string, CacheRow & { provider: string }>> {
  const rows = await db.all<{ Provider: string; CacheKey: string; PayloadJson: string; ContentType: string; RetrievedAtUtc: string; ExpiresAtUtc: string; PayloadBytes: number }>(
    'SELECT * FROM "IslamicContentCacheEntries"',
  );
  return new Map(
    rows.map((row) => [
      row.CacheKey,
      {
        provider: row.Provider,
        cacheKey: row.CacheKey,
        payloadJson: row.PayloadJson,
        contentType: row.ContentType,
        retrievedAtUtc: new Date(row.RetrievedAtUtc),
        expiresAtUtc: new Date(row.ExpiresAtUtc),
        payloadBytes: row.PayloadBytes,
      },
    ]),
  );
}

interface StubFetch {
  fetch: typeof fetch;
  urls: string[];
}

function stubFetch(factory: (url: string) => Response): StubFetch {
  const stub: StubFetch = {
    urls: [],
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      stub.urls.push(url);
      return factory(url);
    },
  };
  return stub;
}

const NOW = new Date('2026-09-10T12:00:00.000Z');
const DAY = 86_400_000;

function createClient(db: Db, stub: StubFetch, cacheDays = 30): QuranProviderClient {
  return new QuranProviderClient(db, new IslamicContentOptions({ quranCacheDays: cacheDays }), { fetch: stub.fetch, now: () => NOW });
}

function row(cacheKey: string, payload: unknown, expiresAtUtc: Date): CacheRow {
  return {
    cacheKey,
    payloadJson: JSON.stringify(payload),
    contentType: 'application/json',
    retrievedAtUtc: new Date(NOW.getTime() - DAY),
    expiresAtUtc,
    payloadBytes: 0,
  };
}

describe('normalizeQuranPath', () => {
  it.each([
    ['/surah/1/', 'surah/1'],
    ['  meta  ', 'meta'],
    ['ayah/262/en.sahih', 'ayah/262/en.sahih'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeQuranPath(input)).toBe(expected);
  });

  it.each(['', '   ', '/', 'a//b', 'a/./b', 'a/../b', 'surah?1', 'surah#1', 'surah\\1', 'surah/1', 'x'.repeat(501), null, undefined])(
    'rejects %j',
    (input) => {
      expect(normalizeQuranPath(input)).toBeNull();
    },
  );
});

describe('QuranProviderClient.isDocumentedPath', () => {
  it.each([
    'surah',
    'surah/1',
    'SURAH/1/en.sahih',
    'surah/1/editions/quran-uthmani,en.sahih',
    'ayah/262',
    'ayah/262/editions/a,b',
    'ayah/random',
    'ayah/random/editions/quran-uthmani,en.sahih,ar.alafasy',
    'edition',
    'edition/language/en',
    'edition/type',
    'hizbQuarter/3/en.sahih',
    'juz/30',
    'meta',
    'quran/quran-uthmani',
    'sajda/en.sahih',
    'search/mercy',
    'search/mercy/all/en',
    'search/mercy/2',
    'page/1',
  ])('accepts %s', (path) => {
    expect(QuranProviderClient.isDocumentedPath(path)).toBe(true);
  });

  it.each(['', 'foo', 'surah/abc', 'surah/1/2/3/4', 'ayah/1/editions/a/b', 'ayah/x/en.sahih', 'edition/xyz', 'edition/type/text/extra', 'search/mercy/x', 'quran/a/b', 'metadata'])(
    'rejects %j',
    (path) => {
      expect(QuranProviderClient.isDocumentedPath(path)).toBe(false);
    },
  );

  it('publishes the 35 documented endpoint templates from QuranProviderClient.cs', () => {
    expect(QuranProviderClient.endpointTemplates).toHaveLength(35);
    expect(QuranProviderClient.endpointTemplates[0]).toBe('/ayah/random');
    expect(QuranProviderClient.endpointTemplates.at(-1)).toBe('/surah/{number}/editions/{editions}');
  });
});

describe('normalizeQuranQuery', () => {
  it('keeps documented keys only, lower-cases them and sorts by key then value', () => {
    const query = normalizeQuranQuery([
      ['Type', 'translation'],
      ['foo', 'bar'],
      ['limit', ' 5 '],
      ['language', 'fr'],
      ['language', 'en'],
      ['offset', ''],
      ['format', undefined],
    ]);
    expect(query).toBe('?language=en&language=fr&limit=5&type=translation');
  });

  it('returns an empty string without usable parameters', () => {
    expect(normalizeQuranQuery(undefined)).toBe('');
    expect(normalizeQuranQuery([['other', 'x']])).toBe('');
  });

  it('escapes values like Uri.EscapeDataString', () => {
    expect(normalizeQuranQuery([['language', 'العربية']])).toBe('?language=%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9');
    expect(normalizeQuranQuery([['limit', '+7']])).toBe('?limit=%2B7');
  });

  it.each([
    [[['type', 'x'.repeat(101)]], "Query parameter 'type' is too long."],
    [[['offset', 'abc']], "Query parameter 'offset' must be between 0 and 10000."],
    [[['Limit', '10001']], "Query parameter 'Limit' must be between 0 and 10000."],
    [[['limit', '-1']], "Query parameter 'limit' must be between 0 and 10000."],
    [[['type', 'a b']], "Query parameter 'type' contains unsupported characters."],
    [[['language', 'en&x=1']], "Query parameter 'language' contains unsupported characters."],
  ] as Array<[Array<[string, string]>, string]>)('rejects %j', (pairs, message) => {
    expect(() => normalizeQuranQuery(pairs)).toThrow(ArgumentError);
    expect(() => normalizeQuranQuery(pairs)).toThrow(message);
  });
});

describe('canonicalizeQuranRequest', () => {
  it('builds the relative URI and the canonical cache key', () => {
    const request = canonicalizeQuranRequest('/surah/1/', [['Limit', '5']]);
    expect(request).toEqual({ path: 'surah/1', queryString: '?limit=5', relativeUri: 'surah/1?limit=5', cacheKey: '/surah/1?limit=5', isRandom: false });
  });

  it('escapes path segments but keeps the cache key readable', () => {
    const request = canonicalizeQuranRequest('ayah/random/editions/quran-uthmani,en.sahih');
    expect(request.relativeUri).toBe('ayah/random/editions/quran-uthmani%2Cen.sahih');
    expect(request.cacheKey).toBe('/ayah/random/editions/quran-uthmani,en.sahih');
    expect(request.isRandom).toBe(true);
  });

  it('rejects undocumented paths with the ArgumentException message', () => {
    expect(() => canonicalizeQuranRequest('not/documented')).toThrow("The requested path is not part of the documented AlQuran Cloud API. (Parameter 'path')");
  });
});

describe('QuranProviderClient.get', () => {
  beforeEach(async () => {
    await d1.prepare('DELETE FROM "IslamicContentCacheEntries"').run();
  });

  it('returns a fresh cache hit without calling the provider', async () => {
    const db = await seedCache(row('/surah/1', { code: 200, data: { number: 1 } }, new Date(NOW.getTime() + DAY)));
    const stub = stubFetch(() => new Response('{}'));
    const payload = await createClient(db, stub).get('surah/1');

    expect(payload).toEqual({
      json: '{"code":200,"data":{"number":1}}',
      contentType: 'application/json',
      statusCode: 200,
      fromCache: true,
      isStale: false,
      retrievedAtUtc: new Date(NOW.getTime() - DAY),
    });
    expect(stub.urls).toEqual([]);
  });

  it('fetches, validates and caches upstream JSON on a miss', async () => {
    const db = await seedCache();
    const body = '{"code":200,"status":"OK","data":{"name":"سُورَةُ ٱلْفَاتِحَةِ"}}';
    const stub = stubFetch(() => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const payload = await createClient(db, stub, 400).get('surah/1', [['limit', '5']]);

    expect(stub.urls).toEqual(['https://api.alquran.cloud/v1/surah/1?limit=5']);
    expect(payload).toEqual({ json: body, contentType: 'application/json', statusCode: 200, fromCache: false, isStale: false, retrievedAtUtc: NOW });
    const stored = (await storedRows(db)).get('/surah/1?limit=5');
    expect(stored?.provider).toBe('alquran-cloud');
    expect(stored?.payloadJson).toBe(body);
    expect(stored?.payloadBytes).toBe(utf8ByteLength(body));
    expect(stored?.payloadBytes).toBeGreaterThan(body.length);
    expect(stored?.retrievedAtUtc).toEqual(NOW);
    expect(stored?.expiresAtUtc).toEqual(new Date(NOW.getTime() + 365 * DAY));
  });

  it('bypasses a fresh cache entry when forceRefresh is set', async () => {
    const db = await seedCache(row('/meta', { old: true }, new Date(NOW.getTime() + DAY)));
    const stub = stubFetch(() => new Response('{"new":true}', { status: 200 }));
    const payload = await createClient(db, stub).get('meta', undefined, true);
    expect(payload.fromCache).toBe(false);
    expect(payload.json).toBe('{"new":true}');
    const rows = await storedRows(db);
    expect(rows.size).toBe(1);
    expect(rows.get('/meta')?.payloadJson).toBe('{"new":true}');
  });

  it('serves the stale cache when the provider fails', async () => {
    const db = await seedCache(row('/surah/2', { stale: true }, new Date(NOW.getTime() - 1)));
    const stub = stubFetch(() => new Response('upstream broke', { status: 500 }));
    const payload = await createClient(db, stub).get('surah/2');
    expect(payload).toMatchObject({ json: '{"stale":true}', statusCode: 200, fromCache: true, isStale: true });

    const offline = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const fallback = await createClient(db, offline).get('surah/2');
    expect(fallback).toMatchObject({ fromCache: true, isStale: true });
  });

  it('forwards upstream errors verbatim and substitutes a body when empty', async () => {
    const db = await seedCache();
    const notFound = stubFetch(() => new Response('{"code":404,"status":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    const payload = await createClient(db, notFound).get('surah/999');
    expect(payload).toMatchObject({ json: '{"code":404,"status":"Not Found"}', statusCode: 404, fromCache: false, isStale: false });
    expect((await storedRows(db)).size).toBe(0);

    const empty = stubFetch(() => new Response('', { status: 502 }));
    const fallback = await createClient(db, empty).get('surah/999');
    expect(fallback.json).toBe('{"code":502,"status":"UPSTREAM ERROR"}');
    expect(fallback.statusCode).toBe(502);
  });

  it('fails with the provider message when unreachable and nothing is cached', async () => {
    const db = await seedCache();
    const stub = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(createClient(db, stub).get('surah/1')).rejects.toThrow("The Qur'an content provider is currently unavailable.");

    const timeout = stubFetch(() => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    await expect(createClient(db, timeout).get('surah/1')).rejects.toThrow(IslamicContentProviderError);
  });

  it('rejects invalid upstream JSON', async () => {
    const db = await seedCache();
    const stub = stubFetch(() => new Response('<html>', { status: 200 }));
    await expect(createClient(db, stub).get('surah/1')).rejects.toThrow("The Qur'an provider returned an invalid response.");
    const large = stubFetch(() => new Response('<html>' + ' '.repeat(300_000), { status: 200 }));
    await expect(createClient(db, large).get('surah/1')).rejects.toThrow("The Qur'an provider returned an invalid response.");
    expect((await storedRows(db)).size).toBe(0);
  });

  it('passes a payload that is too large for a D1 row through without caching it', async () => {
    const db = await seedCache();
    const body = `{"code":200,"data":"${'x'.repeat(MAX_CACHEABLE_PAYLOAD_BYTES)}"}`;
    const stub = stubFetch(() => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const payload = await createClient(db, stub).get('quran/en.sahih');
    expect(payload.fromCache).toBe(false);
    expect(payload.json.length).toBe(body.length);
    expect((await storedRows(db)).size).toBe(0);
  });

  it('never caches random ayah responses', async () => {
    const db = await seedCache();
    const stub = stubFetch(() => new Response('{"code":200}', { status: 200 }));
    const payload = await createClient(db, stub).get('ayah/random/editions/quran-uthmani,en.sahih');
    expect(payload.fromCache).toBe(false);
    expect(db.lookups).toBe(0);
    expect((await storedRows(db)).size).toBe(0);
  });

  it('rejects undocumented paths before touching the cache or provider', async () => {
    const db = await seedCache();
    const stub = stubFetch(() => new Response('{}'));
    await expect(createClient(db, stub).get('../etc/passwd')).rejects.toThrow(ArgumentError);
    expect(db.lookups).toBe(0);
    expect(stub.urls).toEqual([]);
  });
});
