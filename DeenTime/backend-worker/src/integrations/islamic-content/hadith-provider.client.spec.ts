import { describe, expect, it } from 'vitest';
import { ArgumentError, IslamicContentProviderError } from './errors.js';
import { HadithProviderClient, getHadithInt, getHadithString } from './hadith-provider.client.js';
import { IslamicContentOptions } from './islamic-content-options.js';

interface StubFetch {
  fetch: typeof fetch;
  urls: URL[];
}

function stubFetch(factory: (url: URL, call: number) => Response): StubFetch {
  const stub: StubFetch = {
    urls: [],
    fetch: async (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      stub.urls.push(url);
      return factory(url, stub.urls.length);
    },
  };
  return stub;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

interface Harness {
  client: HadithProviderClient;
  stub: StubFetch;
  delays: number[];
}

function harness(factory: (url: URL, call: number) => Response, apiKey = 'secret-key'): Harness {
  const stub = stubFetch(factory);
  const delays: number[] = [];
  const client = new HadithProviderClient(new IslamicContentOptions({ hadithApiKey: apiKey }), {
    fetch: stub.fetch,
    now: () => new Date('2026-09-10T12:00:00Z'),
    delay: async (ms) => {
      delays.push(ms);
    },
  });
  return { client, stub, delays };
}

describe('HadithProviderClient', () => {
  it('is not configured without an API key and refuses to call the provider', async () => {
    const { client, stub } = harness(() => json({ books: [] }), '   ');
    expect(client.isConfigured).toBe(false);
    await expect(client.getBooks()).rejects.toThrow('The Hadith provider key has not been configured on the server.');
    expect(stub.urls).toEqual([]);
  });

  it('sends the key as the apiKey query parameter and parses books with fallback names', async () => {
    const { client, stub } = harness(() =>
      json({
        status: 200,
        books: [
          { id: 1, bookSlug: 'sahih-bukhari', bookName: 'Sahih Bukhari', writerName: 'Imam Bukhari', hadiths_count: '7563', chapters_count: 99, writerDeath: '256 ھ' },
          { id: '2', slug: 'sahih-muslim', name: 'Sahih Muslim', writer_name: 'Imam Muslim', hadith_count: 7563.0, chapter_count: '56' },
          { id: 0, bookSlug: 'ignored' },
          { id: 3, bookSlug: '   ' },
        ],
      }),
    );

    const books = await client.getBooks();

    expect(stub.urls).toHaveLength(1);
    expect(stub.urls[0]?.origin + stub.urls[0]?.pathname).toBe('https://hadithapi.com/api/books');
    expect(stub.urls[0]?.searchParams.get('apiKey')).toBe('secret-key');
    expect(books).toEqual([
      { id: 1, slug: 'sahih-bukhari', name: 'Sahih Bukhari', writerName: 'Imam Bukhari', aboutWriter: null, writerDeath: '256 ھ', hadithCount: 7563, chapterCount: 99 },
      { id: 2, slug: 'sahih-muslim', name: 'Sahih Muslim', writerName: 'Imam Muslim', aboutWriter: null, writerDeath: null, hadithCount: 7563, chapterCount: 56 },
    ]);
  });

  it('reads chapters from the data envelope and validates slugs', async () => {
    const { client, stub } = harness(() => json({ data: { chapters: [{ id: 10, chapter_number: '1', chapterEnglish: 'Revelation' }, { id: 11, chapterNumber: 0 }] } }));

    const chapters = await client.getChapters('sahih-bukhari');

    expect(stub.urls[0]?.pathname).toBe('/api/sahih-bukhari/chapters');
    expect(chapters).toEqual([{ id: 10, bookSlug: 'sahih-bukhari', chapterNumber: 1, arabic: null, english: 'Revelation', urdu: null }]);
    await expect(client.getChapters('bad slug!')).rejects.toThrow("Invalid Hadith book slug. (Parameter 'slug')");
    await expect(client.getChapters('x'.repeat(81))).rejects.toThrow(ArgumentError);
  });

  it('parses hadith pages with chapter fallbacks and pagination metadata', async () => {
    const { client, stub } = harness(() =>
      json({
        hadiths: {
          current_page: 2,
          last_page: 3,
          per_page: 200,
          total: 500,
          data: [
            { id: 5, hadithNumber: '1', chapter: { chapterNumber: '2' }, hadithEnglish: 'text', status: 'Sahih', volume: 1 },
            { id: 6, hadith_number: '2', chapterId: 4, book_slug: 'other' },
            { id: 7, hadithNumber: '' },
            { id: 0, hadithNumber: '9' },
          ],
        },
      }),
    );

    const page = await client.getHadithPage('sahih-bukhari', 2);

    expect(stub.urls[0]?.pathname).toBe('/api/hadiths');
    expect(Object.fromEntries(stub.urls[0]?.searchParams ?? [])).toEqual({ book: 'sahih-bukhari', paginate: '200', page: '2', apiKey: 'secret-key' });
    expect(page).toMatchObject({ currentPage: 2, lastPage: 3, perPage: 200, total: 500 });
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({ id: 5, hadithNumber: '1', bookSlug: 'sahih-bukhari', chapterNumber: 2, english: 'text', status: 'Sahih', volume: 1 });
    expect(page.records[1]).toMatchObject({ id: 6, hadithNumber: '2', bookSlug: 'other', chapterNumber: 4 });
    await expect(client.getHadithPage('sahih-bukhari', 0)).rejects.toThrow("Specified argument was out of the range of valid values. (Parameter 'page')");
  });

  it('rejects unexpected envelopes and non-success status codes', async () => {
    const unexpected = harness(() => json({ hadiths: [] }));
    await expect(unexpected.client.getHadithPage('sahih-bukhari', 1)).rejects.toThrow('The Hadith provider returned an unexpected response.');

    const failing = harness(() => new Response('', { status: 500 }));
    await expect(failing.client.getBooks()).rejects.toThrow('The Hadith provider returned HTTP 500 (InternalServerError).');

    const malformed = harness(() => new Response('{oops', { status: 200 }));
    await expect(malformed.client.getBooks()).rejects.toThrow('The Hadith provider returned an invalid response.');
  });

  it('honours Retry-After on 429 and retries', async () => {
    const { client, stub, delays } = harness((_url, call) => (call === 1 ? json({}, 429, { 'Retry-After': '7' }) : json({ books: [] })));

    await expect(client.getBooks()).resolves.toEqual([]);

    expect(stub.urls).toHaveLength(2);
    expect(delays).toEqual([7_000]);
  });

  it('backs off exponentially without Retry-After and gives up after eight attempts', async () => {
    const { client, stub, delays } = harness(() => json({}, 429));

    await expect(client.getBooks()).rejects.toThrow('The Hadith provider rate limit remained active after automatic retries.');

    expect(stub.urls).toHaveLength(8);
    expect(delays).toEqual([3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000]);
  });

  it('retries transport failures with a growing pause', async () => {
    const { client, stub, delays } = harness((_url, call) => {
      if (call < 3) throw new TypeError('fetch failed');
      return json({ books: [] });
    });

    await expect(client.getBooks()).resolves.toEqual([]);
    expect(stub.urls).toHaveLength(3);
    expect(delays).toEqual([2_000, 4_000]);
  });

  it('turns timeouts into provider errors without retrying', async () => {
    const { client, stub } = harness(() => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    await expect(client.getBooks()).rejects.toThrow(IslamicContentProviderError);
    await expect(client.getBooks()).rejects.toThrow('The Hadith provider timed out.');
    expect(stub.urls).toHaveLength(2);
  });

  it('spaces consecutive requests by 850 ms', async () => {
    const { client, delays } = harness(() => json({ books: [] }));
    await client.getBooks();
    await client.getBooks();
    expect(delays).toEqual([850]);
  });

  it('exposes the supported languages', () => {
    expect(HadithProviderClient.languages).toEqual(['ar', 'en', 'ur']);
  });
});

describe('hadith JSON helpers', () => {
  it('reads properties case-insensitively with JsonElement.ToString semantics', () => {
    const element = { HadithNumber: 12, flag: true, nested: { a: 1 }, empty: null };
    expect(getHadithString(element, 'hadithnumber')).toBe('12');
    expect(getHadithString(element, 'flag')).toBe('True');
    expect(getHadithString(element, 'nested')).toBe('{"a":1}');
    expect(getHadithString(element, 'empty', 'flag')).toBe('True');
    expect(getHadithString(element, 'missing')).toBeNull();
  });

  it('parses integers and truncated decimals', () => {
    expect(getHadithInt({ value: '42' }, 'value')).toBe(42);
    expect(getHadithInt({ value: 12.9 }, 'value')).toBe(12);
    expect(getHadithInt({ value: '1,234' }, 'value')).toBe(1234);
    expect(getHadithInt({ value: 'abc' }, 'value')).toBeNull();
    expect(getHadithInt({}, 'value')).toBeNull();
  });
});
