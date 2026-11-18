import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/core/db.js';
import { IslamicContentOptions } from '../src/integrations/islamic-content/islamic-content-options.js';
import {
  cacheEntryStatements,
  parseQuranEditions,
  safeSyncMessage,
  syncHadithOffline,
  syncQuranOffline,
  syncStateStatement,
  type OfflineSyncDeps,
  type SqlSink,
} from '../src/modules/islamic-content/offline-sync.js';
import { MAX_STATEMENT_BYTES, rowStatements, splitText, sqlLiteral } from '../src/modules/islamic-content/sql-text.js';
import { ArgumentError, IslamicContentProviderError } from '../src/integrations/islamic-content/errors.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const NOW = new Date('2026-11-18T09:30:00.000Z');
const STAMP = NOW.toISOString();

interface StateJson {
  key: string;
  provider: string;
  scope: string;
  status: string;
  processedItems: number;
  totalItems: number;
  message: string | null;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  updatedAtUtc: string;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const EDITIONS = [
  { identifier: 'quran-uthmani', language: 'ar', name: 'عثماني', englishName: 'Uthmani', format: 'text', type: 'quran', direction: 'rtl' },
  { identifier: 'en.sahih', language: 'en', name: 'Saheeh International', englishName: 'Saheeh International', format: 'text', type: 'translation', direction: 'ltr' },
  { identifier: 'ar.alafasy', language: 'ar', name: 'مشاري العفاسي', englishName: 'Alafasy', format: 'audio', type: 'versebyverse', direction: null },
  { identifier: 'fr.hamidullah', language: 'fr', name: 'Hamidullah', englishName: 'Hamidullah', format: 'text', type: 'translation', direction: 'ltr' },
  { language: 'xx', name: 'no identifier' },
];

/** A two-surah, three-ayah "complete edition" in the provider's /quran/{edition} shape. */
function completeEdition(identifier: string): unknown {
  const edition = EDITIONS.find((item) => item.identifier === identifier);
  const audio = edition?.format === 'audio';
  const ayah = (number: number, numberInSurah: number) => ({
    number,
    ...(audio ? { audio: `https://cdn.example/${identifier}/${number}.mp3` } : {}),
    text: `It's ayah ${number}; "${identifier}"`,
    numberInSurah,
    juz: 1,
    sajda: false,
  });
  return {
    code: 200,
    status: 'OK',
    data: {
      surahs: [
        { number: 1, name: 'سُورَةُ ٱلْفَاتِحَةِ', englishName: 'Al-Faatiha', englishNameTranslation: 'The Opening', revelationType: 'Meccan', ayahs: [ayah(1, 1), ayah(2, 2)] },
        { number: 2, name: 'سُورَةُ البَقَرَةِ', englishName: 'Al-Baqara', englishNameTranslation: 'The Cow', revelationType: 'Medinan', ayahs: [ayah(3, 1)] },
      ],
      edition,
    },
  };
}

/** The AlQuran Cloud API, as far as the sync uses it. */
function fakeQuranApi(overrides: (path: string, call: number) => Response | undefined = () => undefined): { fetch: typeof fetch; paths: string[] } {
  const api = {
    paths: [] as string[],
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      expect(url.origin).toBe('https://api.alquran.cloud');
      const path = decodeURIComponent(url.pathname.replace(/^\/v1\//, ''));
      api.paths.push(path);
      const override = overrides(path, api.paths.length);
      if (override) return override;
      if (path === 'edition') return jsonResponse({ code: 200, status: 'OK', data: EDITIONS });
      if (path.startsWith('quran/')) return jsonResponse(completeEdition(path.slice('quran/'.length)));
      return jsonResponse({ code: 200, status: 'OK', data: { path } });
    }) as typeof fetch,
  };
  return api;
}

const BOOKS = [
  { id: 1, bookSlug: 'sahih-bukhari', bookName: "Sahih Bukhari's", writerName: 'Imam Bukhari', writerDeath: '256 ھ', hadiths_count: '3', chapters_count: '2' },
  { id: 2, bookSlug: 'sahih-muslim', bookName: 'Sahih Muslim', writerName: 'Imam Muslim', hadiths_count: '0', chapters_count: '0' },
];

function hadith(id: number, book: string): Record<string, unknown> {
  return {
    id,
    hadithNumber: String(id),
    bookSlug: book,
    chapterId: '1',
    volume: '1',
    status: 'Sahih',
    englishNarrator: 'Narrated Umar',
    hadithEnglish: `Hadith ${id}: it's "quoted"; -- not a comment`,
    hadithUrdu: `حدیث ${id}`,
    hadithArabic: `حديث ${id}\nسطر ثان`,
  };
}

/** hadithapi.com, as far as the sync uses it: two books, the first with two pages of hadith. */
function fakeHadithApi(books: unknown[] = BOOKS): { fetch: typeof fetch; urls: URL[] } {
  const api = {
    urls: [] as URL[],
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      api.urls.push(url);
      expect(url.searchParams.get('apiKey')).toBe('test-hadith-key');
      const path = url.pathname.replace(/^\/api\//, '');
      if (path === 'books') return jsonResponse({ status: 200, books });
      if (path === 'sahih-bukhari/chapters') {
        return jsonResponse({
          chapters: [
            { id: 11, chapterNumber: '1', chapterEnglish: 'Revelation', chapterArabic: 'كتاب بدء الوحي', bookSlug: 'sahih-bukhari' },
            { id: 12, chapterNumber: '2', chapterEnglish: 'Belief', bookSlug: 'sahih-bukhari' },
            { id: 13, chapterNumber: '2', chapterEnglish: 'Duplicate number', bookSlug: 'sahih-bukhari' },
          ],
        });
      }
      if (path.endsWith('/chapters')) return jsonResponse({ chapters: [] });
      if (path === 'hadiths') {
        const page = Number(url.searchParams.get('page'));
        const book = url.searchParams.get('book') ?? '';
        const data = page === 1 ? [hadith(101, book), hadith(102, book)] : [hadith(103, book), hadith(102, book)];
        return jsonResponse({ hadiths: { current_page: page, last_page: 2, per_page: 200, total: 3, data } });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch,
  };
  return api;
}

describe('islamic-content', () => {
  let app: TestApp;
  let superToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
    superToken = (await app.seed.signIn({ roles: ['SuperUser'] })).token;
  });

  /** What scripts/sync-content.mjs does with `wrangler d1 execute --file`: runs the statements in order. */
  function d1Sink(): SqlSink & { labels: string[]; statements: string[] } {
    const sink = {
      labels: [] as string[],
      statements: [] as string[],
      async write(label: string, statements: string[]) {
        sink.labels.push(label);
        sink.statements.push(...statements);
        for (const statement of statements) expect(new TextEncoder().encode(statement).length, label).toBeLessThanOrEqual(100_000);
        for (let start = 0; start < statements.length; start += 50) await app.db.batch(statements.slice(start, start + 50).map((statement) => app.db.stmt(statement)));
      },
    };
    return sink;
  }

  function deps(fetcher: typeof fetch, sink: SqlSink, options: IslamicContentOptions = new IslamicContentOptions({ hadithApiKey: 'test-hadith-key' })): OfflineSyncDeps & { delays: number[] } {
    const delays: number[] = [];
    return {
      options,
      sink,
      delays,
      clientOptions: {
        fetch: fetcher,
        now: () => NOW,
        delay: async (ms) => {
          delays.push(ms);
        },
      },
    };
  }

  async function seedState(provider: string, status: string): Promise<void> {
    await app.db.run(
      'INSERT INTO "IslamicContentSyncStates" ("Key", "Provider", "Scope", "Status", "ProcessedItems", "TotalItems", "Message", "StartedAtUtc", "CompletedAtUtc", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      provider,
      provider,
      'all',
      status,
      3,
      10,
      'Working',
      STAMP,
      null,
      STAMP,
    );
  }

  async function states(): Promise<StateJson[]> {
    const response = await app.request('GET', '/api/v1/islamic-content/status', { token: superToken });
    expect(response.status).toBe(200);
    return (await response.json()) as StateJson[];
  }

  describe('access', () => {
    const routes: Array<[string, string]> = [
      ['GET', '/api/v1/islamic-content/summary'],
      ['GET', '/api/v1/islamic-content/quran/editions'],
      ['GET', '/api/v1/islamic-content/status'],
      ['POST', '/api/v1/islamic-content/sync/quran'],
      ['POST', '/api/v1/islamic-content/sync/hadith'],
      ['GET', '/jobs'],
    ];

    it('is 401 without a session and 403 for administrators who are not super users', async () => {
      const admin = await app.seed.signIn({ roles: ['Admin'] });
      for (const [method, path] of routes) {
        const anonymous = await app.request(method, path, method === 'POST' ? { json: {} } : {});
        expect(anonymous.status, path).toBe(401);
        expect(await anonymous.text()).toBe('');
        const forbidden = await app.request(method, path, method === 'POST' ? { json: {}, token: admin.token } : { token: admin.token });
        expect(forbidden.status, path).toBe(403);
        expect(await forbidden.text()).toBe('');
      }
    });
  });

  describe('summary, editions and status', () => {
    it('summarizes an empty database', async () => {
      const response = await app.request('GET', '/api/v1/islamic-content/summary', { token: superToken });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(Object.keys(body)).toEqual(['quran', 'hadith', 'qibla', 'publicApi', 'syncStates']);
      expect(body.quran).toMatchObject({
        editionCount: 0,
        textEditionCount: 0,
        audioEditionCount: 0,
        languageCount: 0,
        cachedPayloads: 0,
        cachedBytes: 0,
        upstreamServer: 'https://api.alquran.cloud/v1',
        endpointCount: 35,
      });
      expect(body.quran.endpointTemplates).toHaveLength(35);
      expect(body.hadith).toEqual({ configured: false, bookCount: 0, chapterCount: 0, recordCount: 0, languages: ['ar', 'en', 'ur'], languageCoverage: { ar: 0, en: 0, ur: 0 } });
      expect(body.qibla).toEqual({
        provider: 'AlAdhan',
        providerOrganization: 'Islamic Network',
        upstreamServer: 'https://api.aladhan.com/v1',
        endpointCount: 2,
        endpointTemplates: ['/qibla/{latitude}/{longitude}', '/qibla/{latitude}/{longitude}/compass'],
        responseFormats: ['application/json', 'image/png'],
        metadata: '/public/content/qibla/metadata',
      });
      expect(body.publicApi).toEqual({
        capabilities: '/public/content/capabilities',
        quranBase: '/public/content/quran',
        hadithBase: '/public/content/hadith',
        qiblaBase: '/public/content/qibla',
      });
      expect(body.syncStates).toEqual([]);
    });

    it('reports whether a Hadith key is configured without exposing it', async () => {
      const configured = await createTestApp({ settings: { IslamicContent__HadithApiKey: 'server-side-secret' } });
      const response = await configured.request('GET', '/api/v1/islamic-content/summary', { token: superToken });
      const text = await response.text();
      expect((JSON.parse(text) as { hadith: { configured: boolean } }).hadith.configured).toBe(true);
      expect(text).not.toContain('server-side-secret');
    });

    it('fails every request when a base URL is not the primary server', async () => {
      const misconfigured = await createTestApp({ settings: { IslamicContent__QuranBaseUrl: 'https://mirror.example/v1/' } });
      const response = await misconfigured.request('GET', '/api/v1/islamic-content/summary', { token: superToken });
      expect(response.status).toBe(500);
    });

    it('lists sync states ordered by provider and derives /jobs from them', async () => {
      await seedState('quran', 'complete');
      await seedState('hadith', 'running');
      const list = await states();
      expect(list.map((state) => state.provider)).toEqual(['hadith', 'quran']);
      expect(list[0]).toEqual({
        key: 'hadith',
        provider: 'hadith',
        scope: 'all',
        status: 'running',
        processedItems: 3,
        totalItems: 10,
        message: 'Working',
        startedAtUtc: STAMP,
        completedAtUtc: null,
        updatedAtUtc: STAMP,
      });

      const jobs = await app.request('GET', '/jobs', { token: superToken });
      expect(jobs.status).toBe(200);
      expect(await jobs.json()).toEqual({ queued: ['hadith'], syncStates: list });
      expect((await app.request('GET', '/jobs/', { token: superToken })).status).toBe(200);
    });
  });

  describe('sync endpoints', () => {
    it('validates the scope like backend-node', async () => {
      const nullScope = await app.request('POST', '/api/v1/islamic-content/sync/quran', { token: superToken, json: { scope: null } });
      expect(nullScope.status).toBe(400);
      expect(((await nullScope.json()) as { errors: unknown }).errors).toEqual({ Scope: ['The Scope field is required.'] });

      const unknown = await app.request('POST', '/api/v1/islamic-content/sync/quran', { token: superToken, json: { scope: 'everything' } });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({ error: 'Scope must be catalog, text, or all.' });

      const wrongType = await app.request('POST', '/api/v1/islamic-content/sync/quran', { token: superToken, json: { scope: 5 } });
      expect(wrongType.status).toBe(400);
    });

    it('answers 409 "offline" with the command instead of pretending to queue a run', async () => {
      const defaultScope = await app.request('POST', '/api/v1/islamic-content/sync/quran', { token: superToken, json: {} });
      expect(defaultScope.status).toBe(409);
      expect(await defaultScope.json()).toEqual({
        error:
          'Content synchronization does not run on this server. Run "node scripts/sync-content.mjs --provider quran --scope catalog" in backend-worker on a computer with Cloudflare access; progress appears here.',
        provider: 'quran',
        scope: 'catalog',
        status: 'offline',
        command: 'node scripts/sync-content.mjs --provider quran --scope catalog',
      });

      const all = await app.request('POST', '/api/v1/islamic-content/sync/quran', { token: superToken, json: { scope: '  ALL ' } });
      expect(all.status).toBe(409);
      expect(await all.json()).toMatchObject({ provider: 'quran', scope: 'all', status: 'offline' });

      const hadithSync = await app.request('POST', '/api/v1/islamic-content/sync/hadith', { token: superToken, json: {} });
      expect(hadithSync.status).toBe(409);
      expect(await hadithSync.json()).toMatchObject({ provider: 'hadith', scope: 'all', status: 'offline', command: 'node scripts/sync-content.mjs --provider hadith' });

      // Nothing was queued or written.
      expect(await states()).toEqual([]);
      expect(await (await app.request('GET', '/jobs', { token: superToken })).json()).toEqual({ queued: [], syncStates: [] });
    });
  });

  describe('SQL text', () => {
    it('escapes literals', () => {
      expect(sqlLiteral(null)).toBe('NULL');
      expect(sqlLiteral(42)).toBe('42');
      expect(sqlLiteral("it's; -- 'x'")).toBe("'it''s; -- ''x'''");
      expect(sqlLiteral('a\u0000b')).toBe("'ab'");
      expect(() => sqlLiteral(Number.NaN)).toThrow();
    });

    it('splits text without cutting a surrogate pair', () => {
      const text = 'ab😀cd';
      const pieces = splitText(text, 3);
      expect(pieces.join('')).toBe(text);
      expect(pieces[0]).toBe('ab');
      expect(splitText('', 3)).toEqual([]);
    });

    it('writes a row larger than one statement in pieces that D1 reassembles exactly', async () => {
      const payload = JSON.stringify({ code: 200, data: `${"ٱلْحَمْدُ لِلَّهِ 'رَبِّ' ٱلْعَٰلَمِينَ 😀 ".repeat(9_000)}end` });
      const statements = cacheEntryStatements('/meta', payload, 'application/json', NOW, 30);
      expect(statements.length).toBeGreaterThan(3);
      for (const statement of statements) expect(new TextEncoder().encode(statement).length).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
      await app.db.batch(statements.map((statement) => app.db.stmt(statement)));
      // Applying the same statements again replaces the row instead of appending to it.
      await app.db.batch(statements.map((statement) => app.db.stmt(statement)));

      const stored = await app.db.all<{ PayloadJson: string; PayloadBytes: number; ExpiresAtUtc: string }>('SELECT "PayloadJson", "PayloadBytes", "ExpiresAtUtc" FROM "IslamicContentCacheEntries"');
      expect(stored).toHaveLength(1);
      expect(stored[0]?.PayloadJson).toBe(payload);
      expect(stored[0]?.PayloadBytes).toBe(new TextEncoder().encode(payload).length);
      expect(stored[0]?.ExpiresAtUtc).toBe('2026-12-18T09:30:00.000Z');
    });

    it('does not write payloads that exceed a D1 row, and keeps small rows to one statement', () => {
      expect(cacheEntryStatements('/quran/en.sahih', 'x'.repeat(1_900_000), 'application/json', NOW, 30)).toEqual([]);
      expect(rowStatements('QuranEditions', { Identifier: 'a', Name: "b'c" }, { key: ['Identifier'], upsert: true })).toEqual([
        `INSERT INTO "QuranEditions" ("Identifier", "Name") VALUES ('a', 'b''c') ON CONFLICT ("Identifier") DO UPDATE SET "Name" = excluded."Name";`,
      ]);
    });

    it('keeps the timestamps of a state row the way backend-node setState did', async () => {
      const later = new Date(NOW.getTime() + 60_000);
      await app.db.batch([
        app.db.stmt(syncStateStatement('Quran', 'all', 'running', { processed: 0, total: 1, message: 'Starting', started: true }, NOW)),
        app.db.stmt(syncStateStatement('Quran', 'all', 'running', { message: 'Half way' }, later)),
      ]);
      expect((await states())[0]).toEqual({
        key: 'quran',
        provider: 'Quran',
        scope: 'all',
        status: 'running',
        processedItems: 0,
        totalItems: 1,
        message: 'Half way',
        startedAtUtc: STAMP,
        completedAtUtc: null,
        updatedAtUtc: later.toISOString(),
      });

      await app.db.run(syncStateStatement('Quran', 'all', 'failed', { completed: true }, later));
      expect((await states())[0]).toMatchObject({ status: 'failed', message: null, processedItems: 0, totalItems: 1, startedAtUtc: STAMP, completedAtUtc: later.toISOString() });
      await app.db.run(syncStateStatement('Quran', 'catalog', 'running', { processed: 0, total: 1, started: true }, later));
      expect((await states())[0]).toMatchObject({ scope: 'catalog', startedAtUtc: later.toISOString(), completedAtUtc: null });
    });

    it('parses the edition catalogue and hides unexpected error details', () => {
      expect(parseQuranEditions(JSON.stringify({ data: EDITIONS }), NOW).map((edition) => edition.identifier)).toEqual(['quran-uthmani', 'en.sahih', 'ar.alafasy', 'fr.hamidullah']);
      expect(parseQuranEditions(JSON.stringify({ data: EDITIONS }), NOW)[2]).toEqual({
        identifier: 'ar.alafasy',
        language: 'ar',
        name: 'مشاري العفاسي',
        englishName: 'Alafasy',
        format: 'audio',
        type: 'versebyverse',
        direction: null,
        syncedAtUtc: NOW,
      });
      expect(() => parseQuranEditions('{"data":{}}', NOW)).toThrow("The Qur'an edition catalogue had an unexpected shape.");
      expect(safeSyncMessage(new IslamicContentProviderError('Provider said no.'))).toBe('Provider said no.');
      expect(safeSyncMessage(new ArgumentError('Bad scope.'))).toBe('Bad scope.');
      expect(safeSyncMessage(new Error('D1_ERROR: secret detail'))).toBe('Synchronization failed. See the sync script output for technical details.');
    });
  });

  describe("offline Qur'an sync", () => {
    it('catalog scope stores the editions and the catalogue metadata', async () => {
      await app.db.run(
        `INSERT INTO "QuranEditions" ("Identifier", "Language", "Name", "EnglishName", "Format", "Type", "Direction", "SyncedAtUtc") VALUES ('old.edition', 'en', 'Old', 'Old', 'text', 'translation', 'ltr', '2020-01-01T00:00:00.000Z')`,
      );
      const api = fakeQuranApi();
      const sink = d1Sink();

      const result = await syncQuranOffline({ scope: ' Catalog ' }, deps(api.fetch, sink));

      expect(result).toEqual({ editions: 4, cataloguePayloads: 14, ayahEditions: [], ayahRows: 0 });
      expect(api.paths[0]).toBe('edition');
      expect([...api.paths].sort()).toEqual(
        [
          'edition',
          'meta',
          'surah',
          'edition/type',
          'edition/format',
          'edition/language',
          'edition/type/quran',
          'edition/type/translation',
          'edition/type/versebyverse',
          'edition/format/text',
          'edition/format/audio',
          'edition/language/ar',
          'edition/language/en',
          'edition/language/fr',
        ].sort(),
      );
      expect(sink.labels).toEqual(['quran-state', 'quran-catalogue', 'quran-state']);

      const editions = await app.request('GET', '/api/v1/islamic-content/quran/editions', { token: superToken });
      const body = (await editions.json()) as { data: Array<Record<string, unknown>>; total: number };
      expect(body.total).toBe(4);
      expect(body.data.map((edition) => edition.identifier)).toEqual(['ar.alafasy', 'quran-uthmani', 'en.sahih', 'fr.hamidullah']);
      expect(body.data[0]).toEqual({
        identifier: 'ar.alafasy',
        language: 'ar',
        name: 'مشاري العفاسي',
        englishName: 'Alafasy',
        format: 'audio',
        type: 'versebyverse',
        direction: null,
        syncedAtUtc: STAMP,
      });
      const filtered = await app.request('GET', '/api/v1/islamic-content/quran/editions?Language=ar&format=text&type=%20', { token: superToken });
      expect(((await filtered.json()) as { data: Array<{ identifier: string }> }).data.map((edition) => edition.identifier)).toEqual(['quran-uthmani']);

      expect(await states()).toEqual([
        {
          key: 'quran',
          provider: 'quran',
          scope: 'catalog',
          status: 'complete',
          processedItems: 14,
          totalItems: 14,
          message: '4 editions and all catalogue metadata are ready.',
          startedAtUtc: STAMP,
          completedAtUtc: STAMP,
          updatedAtUtc: STAMP,
        },
      ]);

      const summary = (await (await app.request('GET', '/api/v1/islamic-content/summary', { token: superToken })).json()) as Record<string, any>;
      expect(summary.quran).toMatchObject({ editionCount: 4, textEditionCount: 3, audioEditionCount: 1, languageCount: 3, cachedPayloads: 14 });
      expect(summary.quran.cachedBytes).toBeGreaterThan(0);
      expect(summary.syncStates).toHaveLength(1);

      // The stored payloads are what the public proxy serves, without a provider request.
      const cached = await app.request('GET', '/public/content/quran/edition/language/fr', { token: superToken });
      expect(cached.status).toBe(200);
      expect(cached.headers.get('X-IqamaTime-Source')).toBe('cache');
      expect(await cached.json()).toEqual({ code: 200, status: 'OK', data: { path: 'edition/language/fr' } });
    });

    it('scope all splits the showcase editions into ayah rows that the showcase routes serve', async () => {
      const api = fakeQuranApi();
      const sink = d1Sink();

      const result = await syncQuranOffline({ scope: 'all' }, deps(api.fetch, sink));

      expect(result.ayahEditions).toEqual(['quran-uthmani', 'en.sahih', 'ar.alafasy']);
      expect(result.ayahRows).toBe(9);
      expect(sink.labels).toEqual(['quran-state', 'quran-catalogue', 'quran-ayahs-quran-uthmani', 'quran-ayahs-en.sahih', 'quran-ayahs-ar.alafasy', 'quran-state']);
      expect(api.paths.filter((path) => path.startsWith('quran/'))).toEqual(['quran/quran-uthmani', 'quran/en.sahih', 'quran/ar.alafasy']);
      const keys = await app.db.all<{ CacheKey: string }>(`SELECT "CacheKey" FROM "IslamicContentCacheEntries" WHERE "CacheKey" LIKE '/ayah/%' ORDER BY "CacheKey"`);
      expect(keys).toHaveLength(9);
      expect(keys[0]?.CacheKey).toBe('/ayah/1/ar.alafasy');
      expect((await states())[0]).toMatchObject({
        status: 'complete',
        scope: 'all',
        processedItems: 17,
        totalItems: 17,
        message: '4 editions, the catalogue metadata and the ayahs of 3 editions (quran-uthmani, en.sahih, ar.alafasy) are ready.',
      });

      const recitation = await app.request('GET', '/public/content/quran/showcase/ayah/3/recitation/ar.alafasy', { token: superToken });
      expect(recitation.status).toBe(200);
      expect(recitation.headers.get('X-IqamaTime-Source')).toBe('cache');
      expect(await recitation.json()).toEqual({
        code: 200,
        status: 'OK',
        data: {
          number: 3,
          audio: 'https://cdn.example/ar.alafasy/3.mp3',
          text: `It's ayah 3; "ar.alafasy"`,
          numberInSurah: 1,
          juz: 1,
          sajda: false,
          edition: EDITIONS[2],
          surah: { number: 2, name: 'سُورَةُ البَقَرَةِ', englishName: 'Al-Baqara', englishNameTranslation: 'The Cow', revelationType: 'Medinan' },
        },
      });

      // The same row answers the provider-shaped proxy path, with the full surah descriptor.
      const proxied = (await (await app.request('GET', '/public/content/quran/ayah/3/ar.alafasy', { token: superToken })).json()) as { data: { surah: Record<string, unknown> } };
      expect(proxied.data.surah.numberOfAyahs).toBe(1);

      // Running it again replaces the rows instead of duplicating them.
      await syncQuranOffline({ scope: 'all' }, deps(fakeQuranApi().fetch, d1Sink()));
      expect(await app.db.all(`SELECT "CacheKey" FROM "IslamicContentCacheEntries" WHERE "CacheKey" LIKE '/ayah/%'`)).toHaveLength(9);
    });

    it('scope text keeps to text editions, and --editions selects which ones', async () => {
      const text = await syncQuranOffline({ scope: 'text' }, deps(fakeQuranApi().fetch, d1Sink()));
      expect(text.ayahEditions).toEqual(['quran-uthmani', 'en.sahih']);

      const chosen = await syncQuranOffline({ scope: 'text', editions: ['FR.hamidullah', 'ar.alafasy'] }, deps(fakeQuranApi().fetch, d1Sink()));
      expect(chosen.ayahEditions).toEqual(['fr.hamidullah']);

      const everything = await syncQuranOffline({ scope: 'all', editions: 'all' }, deps(fakeQuranApi().fetch, d1Sink()));
      expect(everything.ayahEditions).toEqual(['quran-uthmani', 'en.sahih', 'ar.alafasy', 'fr.hamidullah']);
    });

    it('retries rate limits and server errors with the backend-node back-off', async () => {
      const api = fakeQuranApi((path, call) => {
        if (path === 'edition' && call <= 2) return jsonResponse('slow down', 429);
        if (path === 'meta' && !api.paths.slice(0, -1).includes('meta')) return jsonResponse('oops', 500);
        return undefined;
      });
      const run = deps(api.fetch, d1Sink());
      await syncQuranOffline({ scope: 'catalog' }, run);
      expect(run.delays).toEqual([2_000, 4_000, 350]);
      expect((await states())[0]?.status).toBe('complete');
    });

    it('records a failed state with a safe message and rethrows', async () => {
      const unknownScope = deps(fakeQuranApi().fetch, d1Sink());
      await expect(syncQuranOffline({ scope: 'everything' }, unknownScope)).rejects.toThrow("Qur'an sync scope must be catalog, text, or all.");
      expect((await states())[0]).toMatchObject({ status: 'failed', scope: 'everything', message: "Qur'an sync scope must be catalog, text, or all.", completedAtUtc: STAMP });

      const failing = fakeQuranApi((path) => (path === 'surah' ? jsonResponse('down', 503) : undefined));
      await expect(syncQuranOffline({ scope: 'catalog' }, deps(failing.fetch, d1Sink()))).rejects.toThrow(IslamicContentProviderError);
      expect((await states())[0]).toMatchObject({
        status: 'failed',
        scope: 'catalog',
        message: "The Qur'an provider could not supply the documented endpoint '/surah' (HTTP 503).",
        startedAtUtc: STAMP,
        completedAtUtc: STAMP,
      });
      expect(failing.paths.filter((path) => path === 'surah')).toHaveLength(3);
      // Nothing of the failed run was stored.
      expect(await app.db.all('SELECT "Identifier" FROM "QuranEditions"')).toEqual([]);

      const offline = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      await expect(syncQuranOffline({ scope: 'catalog' }, deps(offline, d1Sink()))).rejects.toThrow("The Qur'an content provider is currently unavailable.");

      await expect(syncQuranOffline({ scope: 'all', editions: ['no.such'] }, deps(fakeQuranApi().fetch, d1Sink()))).rejects.toThrow("Unknown Qur'an edition: no.such.");

      const brokenEdition = fakeQuranApi((path) => (path === 'quran/en.sahih' ? jsonResponse({ code: 200, data: {} }) : undefined));
      await expect(syncQuranOffline({ scope: 'text' }, deps(brokenEdition.fetch, d1Sink()))).rejects.toThrow("The Qur'an edition 'en.sahih' had an unexpected shape.");
      expect((await states())[0]).toMatchObject({ status: 'failed', message: "The Qur'an edition 'en.sahih' had an unexpected shape." });
    });

    it('hides unexpected errors from the state message', async () => {
      const sink = d1Sink();
      const write = sink.write.bind(sink);
      sink.write = async (label, statements) => {
        if (label === 'quran-catalogue') throw new Error('wrangler exited with code 1: token abc');
        await write(label, statements);
      };
      await expect(syncQuranOffline({ scope: 'catalog' }, deps(fakeQuranApi().fetch, sink))).rejects.toThrow('wrangler exited');
      expect((await states())[0]).toMatchObject({ status: 'failed', message: 'Synchronization failed. See the sync script output for technical details.' });
    });
  });

  describe('offline Hadith sync', () => {
    it('imports every book with its chapters and records, which the public API then serves', async () => {
      // Left over from an earlier import: replaced or removed.
      await app.db.batch([
        app.db.stmt(`INSERT INTO "HadithBooks" ("ProviderId", "BookSlug", "BookName", "WriterName", "HadithCount", "ChapterCount", "SyncedAtUtc") VALUES (9, 'gone-book', 'Gone', 'x', 1, 0, '2020-01-01T00:00:00.000Z')`),
        app.db.stmt(`INSERT INTO "HadithRecords" ("Id", "ProviderId", "HadithNumber", "BookSlug", "SyncedAtUtc") VALUES ('${newId()}', 900, '1', 'gone-book', '2020-01-01T00:00:00.000Z')`),
        app.db.stmt(`INSERT INTO "HadithRecords" ("Id", "ProviderId", "HadithNumber", "BookSlug", "SyncedAtUtc") VALUES ('${newId()}', 100, '100', 'sahih-bukhari', '2020-01-01T00:00:00.000Z')`),
      ]);
      const api = fakeHadithApi();
      const sink = d1Sink();
      const run = deps(api.fetch, sink);

      const result = await syncHadithOffline({}, run);

      expect(result).toEqual({ books: 2, chapters: 3, records: 4 });
      expect(sink.labels).toEqual(['hadith-state', 'hadith-state', 'hadith-sahih-bukhari', 'hadith-sahih-muslim', 'hadith-state']);
      expect(api.urls.map((url) => url.pathname.replace('/api/', '') + (url.searchParams.get('page') ? `#${url.searchParams.get('page')}` : ''))).toEqual([
        'books',
        'sahih-bukhari/chapters',
        'hadiths#1',
        'hadiths#2',
        'sahih-muslim/chapters',
      ]);
      // The key is sent to the provider only: it is not in any statement.
      expect(sink.statements.join('\n')).not.toContain('test-hadith-key');

      const books = (await (await app.request('GET', '/public/content/hadith/books', { token: superToken })).json()) as { data: Array<Record<string, unknown>> };
      expect(books.data).toEqual([
        {
          id: 1,
          slug: 'sahih-bukhari',
          name: "Sahih Bukhari's",
          writerName: 'Imam Bukhari',
          aboutWriter: null,
          writerDeath: '256 ھ',
          hadithCount: 3,
          chapterCount: 2,
          languages: ['ar', 'en', 'ur'],
          syncedAtUtc: STAMP,
        },
        { id: 2, slug: 'sahih-muslim', name: 'Sahih Muslim', writerName: 'Imam Muslim', aboutWriter: null, writerDeath: null, hadithCount: 0, chapterCount: 0, languages: ['ar', 'en', 'ur'], syncedAtUtc: STAMP },
      ]);

      const chapters = (await (await app.request('GET', '/public/content/hadith/books/sahih-bukhari/chapters', { token: superToken })).json()) as { data: Array<Record<string, unknown>> };
      expect(chapters.data).toEqual([
        { id: 11, bookSlug: 'sahih-bukhari', chapterNumber: 1, chapterArabic: 'كتاب بدء الوحي', chapterEnglish: 'Revelation', chapterUrdu: null },
        { id: 12, bookSlug: 'sahih-bukhari', chapterNumber: 2, chapterArabic: null, chapterEnglish: 'Belief', chapterUrdu: null },
      ]);

      const hadiths = (await (await app.request('GET', '/public/content/hadith/hadiths', { token: superToken })).json()) as { items: Array<Record<string, unknown>>; total: number };
      expect(hadiths.total).toBe(3);
      expect(hadiths.items.map((item) => item.id)).toEqual([101, 102, 103]);
      expect(hadiths.items[0]).toEqual({
        id: 101,
        hadithNumber: '101',
        bookSlug: 'sahih-bukhari',
        chapterNumber: 1,
        volume: 1,
        status: 'Sahih',
        englishNarrator: 'Narrated Umar',
        urduNarrator: null,
        hadithEnglish: `Hadith 101: it's "quoted"; -- not a comment`,
        hadithUrdu: 'حدیث 101',
        hadithArabic: 'حديث 101\nسطر ثان',
        headingEnglish: null,
        headingUrdu: null,
        headingArabic: null,
        syncedAtUtc: STAMP,
      });

      expect(await states()).toEqual([
        {
          key: 'hadith',
          provider: 'hadith',
          scope: 'all',
          status: 'complete',
          processedItems: 5,
          totalItems: 5,
          message: '2 books are ready with Arabic, English, and Urdu content.',
          startedAtUtc: STAMP,
          completedAtUtc: STAMP,
          updatedAtUtc: STAMP,
        },
      ]);
      const summary = (await (await app.request('GET', '/api/v1/islamic-content/summary', { token: superToken })).json()) as Record<string, any>;
      expect(summary.hadith).toMatchObject({ bookCount: 2, chapterCount: 2, recordCount: 3, languageCoverage: { ar: 3, en: 3, ur: 3 } });
    });

    it('imports only the requested books and then leaves the others alone', async () => {
      await app.db.run(`INSERT INTO "HadithBooks" ("ProviderId", "BookSlug", "BookName", "WriterName", "HadithCount", "ChapterCount", "SyncedAtUtc") VALUES (9, 'other-book', 'Other', 'x', 0, 0, '2020-01-01T00:00:00.000Z')`);
      const result = await syncHadithOffline({ books: ['sahih-bukhari'] }, deps(fakeHadithApi().fetch, d1Sink()));
      expect(result).toEqual({ books: 1, chapters: 3, records: 4 });
      expect((await app.db.all<{ BookSlug: string }>('SELECT "BookSlug" FROM "HadithBooks" ORDER BY "ProviderId"')).map((row) => row.BookSlug)).toEqual(['sahih-bukhari', 'other-book']);
      expect((await states())[0]?.message).toBe('1 of 2 books were imported with Arabic, English, and Urdu content.');

      await expect(syncHadithOffline({ books: ['no-such-book'] }, deps(fakeHadithApi().fetch, d1Sink()))).rejects.toThrow('Unknown Hadith book: no-such-book.');
      expect((await states())[0]).toMatchObject({ status: 'failed', message: 'Unknown Hadith book: no-such-book.' });
    });

    it('fails without an API key before calling the provider', async () => {
      const api = fakeHadithApi();
      await expect(syncHadithOffline({}, deps(api.fetch, d1Sink(), new IslamicContentOptions()))).rejects.toThrow('The Hadith provider key has not been configured on the server.');
      expect(api.urls).toEqual([]);
      expect((await states())[0]).toMatchObject({ status: 'failed', message: 'The Hadith provider key has not been configured on the server.' });
    });

    it('records provider failures and keeps what earlier books stored', async () => {
      const api = fakeHadithApi();
      const failing = (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.pathname === '/api/sahih-muslim/chapters') return jsonResponse({}, 500);
        return api.fetch(input);
      }) as typeof fetch;
      await expect(syncHadithOffline({}, deps(failing, d1Sink()))).rejects.toThrow('The Hadith provider returned HTTP 500 (InternalServerError).');
      expect((await states())[0]).toMatchObject({ status: 'failed', message: 'The Hadith provider returned HTTP 500 (InternalServerError).', processedItems: 5 });
      expect(await app.db.all('SELECT "ProviderId" FROM "HadithRecords"')).toHaveLength(3);
    });
  });
});
