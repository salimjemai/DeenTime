import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../src/core/db.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const NOW = '2026-11-18T09:30:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface FakeProvider {
  urls: string[];
}

/** Replaces the global fetch the provider clients use; no test touches the network. */
function fakeProvider(factory: (url: URL) => Response | Promise<Response>): FakeProvider {
  const fake: FakeProvider = { urls: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    fake.urls.push(url.href);
    return factory(url);
  });
  return fake;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ayahPayload(number: number, edition: string, format: string): unknown {
  return {
    code: 200,
    status: 'OK',
    data: {
      number,
      ...(format === 'audio' ? { audio: `https://cdn.example/${edition}/${number}.mp3` } : {}),
      text: `text ${number} ${edition}`,
      numberInSurah: number,
      juz: 1,
      sajda: false,
      edition: { identifier: edition, language: 'ar', name: edition, englishName: edition, format, type: 'quran' },
      surah: { number: 1, name: 'سُورَةُ ٱلْفَاتِحَةِ', englishName: 'Al-Faatiha', englishNameTranslation: 'The Opening', numberOfAyahs: 7, revelationType: 'Meccan' },
    },
  };
}

const TRIMMED_SURAH = { number: 1, name: 'سُورَةُ ٱلْفَاتِحَةِ', englishName: 'Al-Faatiha', englishNameTranslation: 'The Opening', revelationType: 'Meccan' };

describe('public-content', () => {
  let app: TestApp;
  let superToken: string;
  let adminToken: string;
  let organizationId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
    const superUser = await app.seed.signIn({ roles: ['SuperUser'] });
    superToken = superUser.token;
    organizationId = superUser.organization.id;
    adminToken = (await app.seed.signIn({ roles: ['Admin'] })).token;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createClientKey(scopes: string[] = ['content:read'], requestsPerMinute = 60): Promise<{ clientKey: string; id: string }> {
    const response = await app.request('POST', `/api/v1/orgs/${organizationId}/api-clients`, { token: superToken, json: { name: `Website ${newId()}`, scopes, requestsPerMinute } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { clientKey: string; client: { id: string } };
    return { clientKey: body.clientKey, id: body.client.id };
  }

  async function seedCache(cacheKey: string, payload: unknown, expiresAtUtc = FUTURE): Promise<void> {
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await app.db.run(
      'INSERT INTO "IslamicContentCacheEntries" ("Id", "Provider", "CacheKey", "PayloadJson", "ContentType", "RetrievedAtUtc", "ExpiresAtUtc", "PayloadBytes") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      'alquran-cloud',
      cacheKey,
      json,
      'application/json',
      NOW,
      expiresAtUtc,
      json.length,
    );
  }

  async function seedEdition(identifier: string, format: string, language = 'ar'): Promise<void> {
    await app.db.run(
      'INSERT INTO "QuranEditions" ("Identifier", "Language", "Name", "EnglishName", "Format", "Type", "Direction", "SyncedAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      identifier,
      language,
      identifier,
      identifier,
      format,
      'quran',
      'rtl',
      NOW,
    );
  }

  async function seedBook(providerId: number, slug: string, name: string): Promise<void> {
    await app.db.run(
      'INSERT INTO "HadithBooks" ("ProviderId", "BookSlug", "BookName", "WriterName", "AboutWriter", "WriterDeath", "HadithCount", "ChapterCount", "SyncedAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      providerId,
      slug,
      name,
      'Imam',
      null,
      '256',
      2,
      1,
      NOW,
    );
  }

  async function seedChapter(providerId: number, slug: string, chapterNumber: number): Promise<void> {
    await app.db.run(
      'INSERT INTO "HadithChapters" ("Id", "ProviderId", "BookSlug", "ChapterNumber", "ChapterEnglish", "ChapterUrdu", "ChapterArabic", "SyncedAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      providerId,
      slug,
      chapterNumber,
      `Chapter ${chapterNumber}`,
      null,
      'باب',
      NOW,
    );
  }

  async function seedHadith(providerId: number, slug: string, columns: Record<string, string | number | null> = {}): Promise<void> {
    const row: Record<string, string | number | null> = {
      Id: newId(),
      ProviderId: providerId,
      HadithNumber: String(providerId),
      BookSlug: slug,
      ChapterNumber: 1,
      Volume: 1,
      Status: 'Sahih',
      EnglishNarrator: 'Narrated Umar',
      UrduNarrator: null,
      HadithEnglish: 'Actions are judged by intentions',
      HadithUrdu: null,
      HadithArabic: 'إنما الأعمال بالنيات',
      HeadingEnglish: null,
      HeadingUrdu: null,
      HeadingArabic: null,
      SyncedAtUtc: NOW,
      ...columns,
    };
    const names = Object.keys(row);
    await app.db.run(`INSERT INTO "HadithRecords" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, ...names.map((name) => row[name]));
  }

  describe('capabilities and metadata', () => {
    it('describes the API to anonymous callers', async () => {
      const response = await app.request('GET', '/public/content/capabilities');
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(Object.keys(body)).toEqual(['apiVersion', 'authentication', 'browserAccess', 'quran', 'qibla', 'hadith']);
      expect(body.authentication).toEqual({
        requiredForContent: true,
        header: 'X-IqamaTime-Client-Key',
        legacyHeader: 'X-DeenTime-Client-Key',
        scope: 'content:read',
        note: 'Administrators may use their MasjidHub session token; external masjid apps must send a client key.',
      });
      expect(body.quran.upstreamServer).toBe('https://api.alquran.cloud/v1');
      expect(body.quran.endpointTemplates).toHaveLength(35);
      expect(body.quran.showcaseRecitation).toBe('/public/content/quran/showcase/ayah/{number}/recitation/{edition}');
      expect(body.qibla.selectedUpstreamServer).toBe('https://api.aladhan.com/v1');
      expect(body.qibla.openApiVersion).toBe('3.1.0');
      expect(body.qibla.routes).toHaveLength(2);
      expect(body.hadith.languages).toEqual(['ar', 'en', 'ur']);

      const metadata = await app.request('GET', '/public/content/qibla/metadata');
      expect(metadata.status).toBe(200);
      expect(((await metadata.json()) as { data: unknown }).data).toEqual(body.qibla);
    });

    it('answers browser preflights for any origin', async () => {
      const preflight = await app.request('OPTIONS', '/public/content/qibla/30.5052/-97.8203', {
        headers: { Origin: 'https://masjid.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-IqamaTime-Client-Key, Authorization' },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('X-IqamaTime-Client-Key');
    });

    it('applies the public rate limit: 60 requests per 5 seconds per address', async () => {
      for (let i = 0; i < 60; i++) expect((await app.request('GET', '/public/content/qibla/metadata')).status).toBe(200);
      const limited = await app.request('GET', '/public/content/qibla/metadata');
      expect(limited.status).toBe(429);
      expect(await limited.text()).toBe('');
    });
  });

  describe('client credentials', () => {
    it('requires a client key or an administrator session on every content route', async () => {
      for (const path of [
        '/public/content/qibla/30.5052/-97.8203',
        '/public/content/qibla/30.5052/-97.8203/compass',
        '/public/content/quran/showcase/random',
        '/public/content/quran/showcase/ayah/1/recitation/ar.alafasy',
        '/public/content/quran/surah/1',
        '/public/content/hadith/books',
        '/public/content/hadith/books/sahih-bukhari/chapters',
        '/public/content/hadith/hadiths',
        '/public/content/hadith/hadiths/random',
        '/public/content/hadith/hadiths/1',
      ]) {
        const response = await app.request('GET', path);
        expect(response.status, path).toBe(401);
        expect(await response.json(), path).toEqual({ error: 'A MasjidHub API client key is required.', header: 'X-IqamaTime-Client-Key', scope: 'content:read' });
      }
    });

    it('accepts administrators and super users by session, not other roles', async () => {
      expect((await app.request('GET', '/public/content/hadith/books', { token: superToken })).status).toBe(200);
      expect((await app.request('GET', '/public/content/hadith/books', { token: adminToken })).status).toBe(200);
      const editor = await app.seed.signIn({ roles: ['Editor'] });
      expect((await app.request('GET', '/public/content/hadith/books', { token: editor.token })).status).toBe(401);
    });

    it('accepts a client key in either header, records the usage and rejects it once revoked', async () => {
      const { clientKey, id } = await createClientKey();
      expect((await app.request('GET', '/public/content/hadith/books', { headers: { 'X-IqamaTime-Client-Key': clientKey } })).status).toBe(200);
      expect((await app.request('GET', '/public/content/hadith/books', { headers: { 'X-DeenTime-Client-Key': clientKey } })).status).toBe(200);
      const usage = await app.db.all<{ Endpoint: string }>('SELECT "Endpoint" FROM "ApiClientUsage" WHERE "ApiClientId" = ?', id);
      expect(usage.map((row) => row.Endpoint)).toEqual(['/public/content/hadith/books', '/public/content/hadith/books']);

      expect((await app.request('POST', `/api/v1/orgs/${organizationId}/api-clients/${id}/revoke`, { token: superToken, json: {} })).status).toBe(204);
      const revoked = await app.request('GET', '/public/content/hadith/books', { headers: { 'X-IqamaTime-Client-Key': clientKey } });
      expect(revoked.status).toBe(401);
      expect(Object.keys((await revoked.json()) as object)).toEqual(['error']);
    });

    it('rejects an unknown key and a key without the content:read scope', async () => {
      const unknown = await app.request('GET', '/public/content/hadith/books', { headers: { 'X-IqamaTime-Client-Key': 'iqt_unknown_secret' } });
      expect(unknown.status).toBe(401);
      expect(typeof ((await unknown.json()) as { error: string }).error).toBe('string');

      const { clientKey } = await createClientKey(['iqama:read']);
      const wrongScope = await app.request('GET', '/public/content/hadith/books', { headers: { 'X-IqamaTime-Client-Key': clientKey } });
      expect(wrongScope.status).toBe(401);
    });

    it('enforces the per-minute quota of the client', async () => {
      const { clientKey } = await createClientKey(['content:read'], 2);
      const headers = { 'X-IqamaTime-Client-Key': clientKey };
      expect((await app.request('GET', '/public/content/hadith/books', { headers })).status).toBe(200);
      expect((await app.request('GET', '/public/content/hadith/books', { headers })).status).toBe(200);
      const limited = await app.request('GET', '/public/content/hadith/books', { headers });
      expect(limited.status).toBe(401);
      expect(await limited.json()).toEqual({ error: 'The API client quota has been reached. Try again later.' });
    });
  });

  describe('qibla', () => {
    it('returns the bearing from the provider, then from the in-memory cache', async () => {
      const provider = fakeProvider(() => jsonResponse({ code: 200, status: 'OK', data: { latitude: 30.5052, longitude: -97.8203, direction: 43.36991455214116 } }));

      const response = await app.request('GET', '/public/content/qibla/30.5052/-97.8203', { token: superToken });
      expect(response.status).toBe(200);
      expect(response.headers.get('X-IqamaTime-Source')).toBe('provider');
      expect(response.headers.get('X-DeenTime-Source')).toBe('provider');
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
      const body = (await response.json()) as { data: Record<string, unknown>; meta: Record<string, unknown>; code: number; status: string };
      expect(response.headers.get('X-IqamaTime-Retrieved')).toBe(body.meta.retrievedAtUtc);
      expect(body).toEqual({
        code: 200,
        status: 'OK',
        data: {
          latitude: 30.5052,
          longitude: -97.8203,
          direction: 43.36991455214116,
          directionUnit: 'degrees',
          bearingConvention: 'clockwise from north',
          destination: { name: 'Al-Kaaba', city: 'Makkah', country: 'Saudi Arabia' },
          compassUrl: '/public/content/qibla/30.5052/-97.8203/compass',
        },
        meta: {
          provider: 'AlAdhan',
          providerOrganization: 'Islamic Network',
          apiVersion: 'v1',
          openApiVersion: '3.1.0',
          upstreamServer: 'https://api.aladhan.com/v1',
          source: 'provider',
          retrievedAtUtc: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
        },
      });
      expect(provider.urls).toEqual(['https://api.aladhan.com/v1/qibla/30.5052/-97.8203']);

      const cached = await app.request('GET', '/public/content/qibla/30.5052/-97.8203', { token: superToken });
      expect(cached.headers.get('X-IqamaTime-Source')).toBe('cache');
      expect(((await cached.json()) as { meta: { source: string } }).meta.source).toBe('cache');
      expect(provider.urls).toHaveLength(1);
    });

    it('rejects coordinates out of range with 400 and non-numeric ones with 404', async () => {
      const provider = fakeProvider(() => jsonResponse({}));
      for (const path of ['/public/content/qibla/91/0', '/public/content/qibla/0/181', '/public/content/qibla/91/0/compass']) {
        const response = await app.request('GET', path, { token: superToken });
        expect(response.status, path).toBe(400);
        expect(await response.json()).toEqual({ error: 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.' });
      }
      for (const path of ['/public/content/qibla/north/0', '/public/content/qibla/1/east/compass']) {
        const response = await app.request('GET', path, { token: superToken });
        expect(response.status, path).toBe(404);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
      }
      // The route constraint is checked before the credentials.
      expect((await app.request('GET', '/public/content/qibla/north/0')).status).toBe(404);
      expect(provider.urls).toEqual([]);
    });

    it('answers 503 with the provider message when the provider fails', async () => {
      fakeProvider(() => jsonResponse('{}', 500));
      const failed = await app.request('GET', '/public/content/qibla/10/10', { token: superToken });
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({ error: 'The Qibla provider returned HTTP 500.' });

      vi.restoreAllMocks();
      fakeProvider(() => {
        throw new TypeError('fetch failed');
      });
      const offline = await app.request('GET', '/public/content/qibla/11/11', { token: superToken });
      expect(offline.status).toBe(503);
      expect(await offline.json()).toEqual({ error: 'The Qibla provider is currently unavailable.' });

      vi.restoreAllMocks();
      fakeProvider(() => jsonResponse({ code: 200, data: { latitude: 12, longitude: 12 } }));
      const incomplete = await app.request('GET', '/public/content/qibla/12/12', { token: superToken });
      expect(incomplete.status).toBe(503);
      expect(await incomplete.json()).toEqual({ error: 'The Qibla provider returned an incomplete response.' });
    });

    it('streams the compass image and maps provider failures to 503', async () => {
      const provider = fakeProvider(() => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }));
      const { clientKey } = await createClientKey();
      const response = await app.request('GET', '/public/content/qibla/30.5052/-97.8203/compass', { headers: { 'X-IqamaTime-Client-Key': clientKey } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('X-IqamaTime-Source')).toBe('provider');
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
      expect(response.headers.get('X-IqamaTime-Retrieved')).toMatch(/Z$/);
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...PNG]);
      expect(provider.urls).toEqual(['https://api.aladhan.com/v1/qibla/30.5052/-97.8203/compass']);

      vi.restoreAllMocks();
      fakeProvider(() => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
      const wrongType = await app.request('GET', '/public/content/qibla/30.5052/-97.8203/compass', { token: superToken });
      expect(wrongType.status).toBe(503);
      expect(await wrongType.json()).toEqual({ error: 'The Qibla provider returned an unexpected compass format.' });
    });
  });

  describe('quran showcase', () => {
    it('serves a random ayah in the three showcase editions from the per-ayah rows', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const provider = fakeProvider(() => jsonResponse({}));
      await seedCache('/ayah/1/quran-uthmani', ayahPayload(1, 'quran-uthmani', 'text'));
      await seedCache('/ayah/1/en.sahih', ayahPayload(1, 'en.sahih', 'text'));
      await seedCache('/ayah/1/ar.alafasy', ayahPayload(1, 'ar.alafasy', 'audio'));

      const response = await app.request('GET', '/public/content/quran/showcase/random', { token: superToken });
      expect(response.status).toBe(200);
      expect(response.headers.get('X-IqamaTime-Source')).toBe('cache');
      expect(response.headers.get('X-DeenTime-Source')).toBe('cache');
      const body = (await response.json()) as { code: number; status: string; data: Array<Record<string, any>> };
      expect(body.code).toBe(200);
      expect(body.status).toBe('OK');
      expect(body.data.map((ayah) => ayah.edition.identifier)).toEqual(['quran-uthmani', 'en.sahih', 'ar.alafasy']);
      expect(body.data[0]).toEqual({
        number: 1,
        text: 'text 1 quran-uthmani',
        numberInSurah: 1,
        juz: 1,
        sajda: false,
        edition: { identifier: 'quran-uthmani', language: 'ar', name: 'quran-uthmani', englishName: 'quran-uthmani', format: 'text', type: 'quran' },
        surah: TRIMMED_SURAH,
      });
      expect(body.data[2]?.audio).toBe('https://cdn.example/ar.alafasy/1.mp3');
      expect(provider.urls).toEqual([]);
    });

    it('falls back to one provider request when an edition is missing, and never caches it', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      await seedCache('/ayah/1/quran-uthmani', ayahPayload(1, 'quran-uthmani', 'text'));
      const upstream = '{"code":200,"status":"OK","data":[{"number":262}]}';
      const provider = fakeProvider(() => jsonResponse(upstream));

      const response = await app.request('GET', '/public/content/quran/showcase/random', { token: superToken });
      expect(response.status).toBe(200);
      expect(response.headers.get('X-IqamaTime-Source')).toBe('provider');
      expect(await response.text()).toBe(upstream);
      expect(provider.urls).toEqual(['https://api.alquran.cloud/v1/ayah/random/editions/quran-uthmani%2Cen.sahih%2Car.alafasy']);
      expect(await app.db.all('SELECT "CacheKey" FROM "IslamicContentCacheEntries"')).toHaveLength(1);
    });

    it('answers 503 when nothing is stored and the provider is unreachable', async () => {
      fakeProvider(() => {
        throw new TypeError('fetch failed');
      });
      const response = await app.request('GET', '/public/content/quran/showcase/random', { token: superToken });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "The Qur'an content provider is currently unavailable." });
    });

    it('validates the ayah number and the audio edition of a recitation', async () => {
      await seedEdition('ar.alafasy', 'audio');
      await seedEdition('en.sahih', 'text', 'en');
      const provider = fakeProvider(() => jsonResponse({}));

      const notANumber = await app.request('GET', '/public/content/quran/showcase/ayah/first/recitation/ar.alafasy', { token: superToken });
      expect(notANumber.status).toBe(404);
      for (const number of [0, 6237, -1]) {
        const response = await app.request('GET', `/public/content/quran/showcase/ayah/${number}/recitation/ar.alafasy`, { token: superToken });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Ayah number must be between 1 and 6236.' });
      }
      for (const edition of ['en.sahih', 'ar.unknown']) {
        const response = await app.request('GET', `/public/content/quran/showcase/ayah/1/recitation/${edition}`, { token: superToken });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Choose a valid audio edition from the MasjidHub Qur'an catalogue." });
      }
      expect(provider.urls).toEqual([]);
    });

    it('serves a recitation from its ayah row', async () => {
      await seedEdition('ar.alafasy', 'audio');
      await seedCache('/ayah/255/ar.alafasy', ayahPayload(255, 'ar.alafasy', 'audio'));
      const provider = fakeProvider(() => jsonResponse({}));

      const response = await app.request('GET', '/public/content/quran/showcase/ayah/255/recitation/%20ar.alafasy%20', { token: superToken });
      expect(response.status).toBe(200);
      expect(response.headers.get('X-IqamaTime-Source')).toBe('cache');
      const body = (await response.json()) as { code: number; status: string; data: Record<string, any> };
      expect(body.code).toBe(200);
      expect(body.data.number).toBe(255);
      expect(body.data.audio).toBe('https://cdn.example/ar.alafasy/255.mp3');
      expect(body.data.surah).toEqual(TRIMMED_SURAH);
      expect(provider.urls).toEqual([]);
    });

    it('fetches a missing recitation from the provider once and stores it', async () => {
      await seedEdition('ar.alafasy', 'audio');
      const upstream = JSON.stringify(ayahPayload(7, 'ar.alafasy', 'audio'));
      const provider = fakeProvider(() => jsonResponse(upstream));

      const first = await app.request('GET', '/public/content/quran/showcase/ayah/7/recitation/ar.alafasy', { token: superToken });
      expect(first.status).toBe(200);
      expect(first.headers.get('X-IqamaTime-Source')).toBe('provider');
      expect(await first.text()).toBe(upstream);
      expect(provider.urls).toEqual(['https://api.alquran.cloud/v1/ayah/7/ar.alafasy']);

      const second = await app.request('GET', '/public/content/quran/showcase/ayah/7/recitation/ar.alafasy', { token: superToken });
      expect(second.headers.get('X-IqamaTime-Source')).toBe('cache');
      expect(((await second.json()) as { data: { number: number } }).data.number).toBe(7);
      expect(provider.urls).toHaveLength(1);
    });

    it('answers 503 when a missing recitation cannot be fetched', async () => {
      await seedEdition('ar.alafasy', 'audio');
      fakeProvider(() => {
        throw new TypeError('fetch failed');
      });
      const response = await app.request('GET', '/public/content/quran/showcase/ayah/7/recitation/ar.alafasy', { token: superToken });
      expect(response.status).toBe(503);
    });
  });

  describe('quran proxy', () => {
    it('fetches a documented path once, caches it and serves the cache afterwards', async () => {
      const upstream = '{"code":200,"status":"OK","data":{"number":1,"name":"سُورَةُ ٱلْفَاتِحَةِ"}}';
      const provider = fakeProvider(() => jsonResponse(upstream));
      const { clientKey } = await createClientKey();
      const headers = { 'X-IqamaTime-Client-Key': clientKey };

      const first = await app.request('GET', '/public/content/quran/surah/1/en.sahih?Limit=5&offset=0&ignored=x', { headers });
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toContain('application/json');
      expect(first.headers.get('X-IqamaTime-Source')).toBe('provider');
      expect(first.headers.get('X-DeenTime-Source')).toBe('provider');
      expect(first.headers.get('X-DeenTime-Retrieved')).toMatch(/^\d{4}-.*Z$/);
      expect(first.headers.get('Warning')).toBeNull();
      expect(await first.text()).toBe(upstream);
      expect(provider.urls).toEqual(['https://api.alquran.cloud/v1/surah/1/en.sahih?limit=5&offset=0']);

      const second = await app.request('GET', '/public/content/quran/surah/1/en.sahih?offset=0&limit=5', { headers });
      expect(second.status).toBe(200);
      expect(second.headers.get('X-IqamaTime-Source')).toBe('cache');
      expect(await second.text()).toBe(upstream);
      expect(provider.urls).toHaveLength(1);

      const stored = await app.db.all<{ CacheKey: string; PayloadBytes: number }>('SELECT "CacheKey", "PayloadBytes" FROM "IslamicContentCacheEntries"');
      expect(stored).toEqual([{ CacheKey: '/surah/1/en.sahih?limit=5&offset=0', PayloadBytes: new TextEncoder().encode(upstream).length }]);
    });

    it('rejects undocumented paths and bad query values with the provider client messages', async () => {
      const provider = fakeProvider(() => jsonResponse({}));
      const undocumented = await app.request('GET', '/public/content/quran/tafsir/1', { token: superToken });
      expect(undocumented.status).toBe(400);
      expect(await undocumented.json()).toEqual({ error: "The requested path is not part of the documented AlQuran Cloud API. (Parameter 'path')" });

      const badLimit = await app.request('GET', '/public/content/quran/surah/1?limit=99999', { token: superToken });
      expect(badLimit.status).toBe(400);
      expect(await badLimit.json()).toEqual({ error: "Query parameter 'limit' must be between 0 and 10000." });

      const badValue = await app.request('GET', '/public/content/quran/edition?language=e%20n', { token: superToken });
      expect(badValue.status).toBe(400);
      expect(await badValue.json()).toEqual({ error: "Query parameter 'language' contains unsupported characters." });

      expect((await app.request('GET', '/public/content/quran', { token: superToken })).status).toBe(404);
      expect((await app.request('GET', '/public/content/quran/', { token: superToken })).status).toBe(404);
      expect(provider.urls).toEqual([]);
    });

    it('serves the stale cache with a Warning header when the provider fails', async () => {
      await seedCache('/meta', '{"stale":true}', PAST);
      const provider = fakeProvider(() => jsonResponse('broken', 500));
      const response = await app.request('GET', '/public/content/quran/meta', { token: superToken });
      expect(response.status).toBe(200);
      expect(response.headers.get('X-IqamaTime-Source')).toBe('cache');
      expect(response.headers.get('Warning')).toBe('110 - Response is stale');
      expect(response.headers.get('X-DeenTime-Retrieved')).toBe(NOW);
      expect(await response.text()).toBe('{"stale":true}');
      expect(provider.urls).toEqual(['https://api.alquran.cloud/v1/meta']);
    });

    it('passes upstream errors through and answers 503 when the provider is unreachable or invalid', async () => {
      fakeProvider(() => jsonResponse('{"code":404,"status":"NOT FOUND","data":"Not found"}', 404));
      const missing = await app.request('GET', '/public/content/quran/surah/999', { token: superToken });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('X-IqamaTime-Source')).toBe('provider');
      expect(await missing.text()).toBe('{"code":404,"status":"NOT FOUND","data":"Not found"}');

      vi.restoreAllMocks();
      fakeProvider(() => {
        throw new TypeError('fetch failed');
      });
      const offline = await app.request('GET', '/public/content/quran/surah/2', { token: superToken });
      expect(offline.status).toBe(503);
      expect(await offline.json()).toEqual({ error: "The Qur'an content provider is currently unavailable." });

      vi.restoreAllMocks();
      fakeProvider(() => new Response('<html>', { status: 200 }));
      const invalid = await app.request('GET', '/public/content/quran/surah/3', { token: superToken });
      expect(invalid.status).toBe(503);
      expect(await invalid.json()).toEqual({ error: "The Qur'an provider returned an invalid response." });
      expect(await app.db.all('SELECT "CacheKey" FROM "IslamicContentCacheEntries"')).toEqual([]);
    });
  });

  describe('hadith', () => {
    beforeEach(async () => {
      await seedBook(2, 'sahih-muslim', 'Sahih Muslim');
      await seedBook(1, 'sahih-bukhari', 'Sahih Bukhari');
      await seedChapter(12, 'sahih-bukhari', 2);
      await seedChapter(11, 'sahih-bukhari', 1);
      await seedHadith(101, 'sahih-bukhari');
      await seedHadith(102, 'sahih-bukhari', { ChapterNumber: 2, Status: 'Hasan', HadithEnglish: 'Religion is 100% sincerity', HadithArabic: '', HadithUrdu: 'دین خیر خواہی ہے' });
      await seedHadith(201, 'sahih-muslim', { HadithEnglish: null, EnglishNarrator: 'Abu Hurairah reported', HadithArabic: 'الطهور شطر الإيمان' });
    });

    it('lists books in provider order', async () => {
      const response = await app.request('GET', '/public/content/hadith/books', { token: superToken });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: Array<Record<string, unknown>>; total: number };
      expect(body.total).toBe(2);
      expect(body.data[0]).toEqual({
        id: 1,
        slug: 'sahih-bukhari',
        name: 'Sahih Bukhari',
        writerName: 'Imam',
        aboutWriter: null,
        writerDeath: '256',
        hadithCount: 2,
        chapterCount: 1,
        languages: ['ar', 'en', 'ur'],
        syncedAtUtc: NOW,
      });
      expect(body.data[1]?.slug).toBe('sahih-muslim');
    });

    it('lists the chapters of a book and answers 404 for an unknown book', async () => {
      const response = await app.request('GET', '/public/content/hadith/books/sahih-bukhari/chapters', { token: superToken });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: [
          { id: 11, bookSlug: 'sahih-bukhari', chapterNumber: 1, chapterArabic: 'باب', chapterEnglish: 'Chapter 1', chapterUrdu: null },
          { id: 12, bookSlug: 'sahih-bukhari', chapterNumber: 2, chapterArabic: 'باب', chapterEnglish: 'Chapter 2', chapterUrdu: null },
        ],
        total: 2,
      });

      const empty = await app.request('GET', '/public/content/hadith/books/sahih-muslim/chapters', { token: superToken });
      expect(await empty.json()).toEqual({ data: [], total: 0 });

      const unknown = await app.request('GET', '/public/content/hadith/books/Sahih-Bukhari/chapters', { token: superToken });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'Hadith book not found.' });
    });

    it('pages hadiths ordered by book then provider id', async () => {
      const response = await app.request('GET', '/public/content/hadith/hadiths', { token: superToken });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Array<Record<string, unknown>>; page: number; pageSize: number; total: number };
      expect({ page: body.page, pageSize: body.pageSize, total: body.total }).toEqual({ page: 1, pageSize: 20, total: 3 });
      expect(body.items.map((item) => item.id)).toEqual([101, 102, 201]);
      expect(body.items[0]).toEqual({
        id: 101,
        hadithNumber: '101',
        bookSlug: 'sahih-bukhari',
        chapterNumber: 1,
        volume: 1,
        status: 'Sahih',
        englishNarrator: 'Narrated Umar',
        urduNarrator: null,
        hadithEnglish: 'Actions are judged by intentions',
        hadithUrdu: null,
        hadithArabic: 'إنما الأعمال بالنيات',
        headingEnglish: null,
        headingUrdu: null,
        headingArabic: null,
        syncedAtUtc: NOW,
      });

      const second = (await (await app.request('GET', '/public/content/hadith/hadiths?PAGE=2&pagesize=2', { token: superToken })).json()) as typeof body;
      expect({ page: second.page, pageSize: second.pageSize, total: second.total }).toEqual({ page: 2, pageSize: 2, total: 3 });
      expect(second.items.map((item) => item.id)).toEqual([201]);

      const clamped = (await (await app.request('GET', '/public/content/hadith/hadiths?page=-4&pageSize=5000', { token: superToken })).json()) as typeof body;
      expect({ page: clamped.page, pageSize: clamped.pageSize }).toEqual({ page: 1, pageSize: 100 });
    });

    it('filters by book, chapter, status, language and search text', async () => {
      const ids = async (query: string): Promise<number[]> => {
        const response = await app.request('GET', `/public/content/hadith/hadiths?${query}`, { token: superToken });
        expect(response.status, query).toBe(200);
        return ((await response.json()) as { items: Array<{ id: number }> }).items.map((item) => item.id);
      };
      expect(await ids('book=sahih-muslim')).toEqual([201]);
      expect(await ids('book=sahih-bukhari&chapter=2')).toEqual([102]);
      expect(await ids('status=Hasan')).toEqual([102]);
      expect(await ids('status=hasan')).toEqual([]);
      expect(await ids('language=ar')).toEqual([101, 201]);
      expect(await ids('language=UR')).toEqual([102]);
      expect(await ids('language=en')).toEqual([101, 102]);
      expect(await ids('search=INTENTIONS')).toEqual([101]);
      expect(await ids('search=abu%20hurairah')).toEqual([201]);
      expect(await ids(`search=${encodeURIComponent('الإيمان')}&language=ar`)).toEqual([201]);
      expect(await ids('search=intentions&language=ar')).toEqual([]);
      // LIKE wildcards in the search text are literal.
      expect(await ids('search=100%25')).toEqual([102]);
      expect(await ids('search=_')).toEqual([]);
    });

    it('rejects invalid numbers, long searches and unsupported languages', async () => {
      const invalid = await app.request('GET', '/public/content/hadith/hadiths?chapter=one&page=1.5');
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get('content-type')).toContain('application/problem+json');
      expect(((await invalid.json()) as { errors: unknown }).errors).toEqual({ chapter: ["The value 'one' is not valid."], page: ["The value '1.5' is not valid."] });

      const longSearch = await app.request('GET', `/public/content/hadith/hadiths?search=${'x'.repeat(201)}`, { token: superToken });
      expect(longSearch.status).toBe(400);
      expect(await longSearch.json()).toEqual({ error: 'Search is limited to 200 characters.' });

      for (const path of ['/public/content/hadith/hadiths?language=fr', '/public/content/hadith/hadiths/random?language=fr']) {
        const response = await app.request('GET', path, { token: superToken });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Language must be ar, en, or ur.' });
      }

      const randomInvalid = await app.request('GET', '/public/content/hadith/hadiths/random?chapter=x', { token: superToken });
      expect(randomInvalid.status).toBe(400);
      expect(((await randomInvalid.json()) as { errors: unknown }).errors).toEqual({ chapter: ["The value 'x' is not valid."] });
    });

    it('returns a random hadith that matches the filters', async () => {
      const response = await app.request('GET', '/public/content/hadith/hadiths/random?book=sahih-muslim', { token: superToken });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { data: { id: number } }).data.id).toBe(201);

      const seen = new Set<number>();
      for (let i = 0; i < 40; i++) {
        const any = await app.request('GET', '/public/content/hadith/hadiths/random?language=en', { token: superToken });
        seen.add(((await any.json()) as { data: { id: number } }).data.id);
      }
      expect([...seen].sort()).toEqual([101, 102]);

      const none = await app.request('GET', '/public/content/hadith/hadiths/random?book=unknown', { token: superToken });
      expect(none.status).toBe(404);
      expect(await none.json()).toEqual({ error: 'No hadith matched the requested filters.' });
    });

    it('returns one hadith by provider id', async () => {
      const response = await app.request('GET', '/public/content/hadith/hadiths/201', { token: superToken });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { data: { id: number; bookSlug: string } }).data).toMatchObject({ id: 201, bookSlug: 'sahih-muslim' });

      const missing = await app.request('GET', '/public/content/hadith/hadiths/999', { token: superToken });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'Hadith not found.' });

      const notANumber = await app.request('GET', '/public/content/hadith/hadiths/abc', { token: superToken });
      expect(notANumber.status).toBe(404);
      expect(notANumber.headers.get('content-type')).toContain('application/problem+json');
    });
  });
});
