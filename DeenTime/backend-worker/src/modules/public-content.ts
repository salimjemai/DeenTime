import { hasRole } from '../core/auth.js';
import { currentUser, db, type App, type Ctx } from '../core/context.js';
import { badRequest, notFound, serviceUnavailable, unauthorized, validationProblem } from '../core/errors.js';
import { pagedResult } from '../core/paged-result.js';
import { rateLimit } from '../core/rate-limit.js';
import { ArgumentError, IslamicContentProviderError } from '../integrations/islamic-content/errors.js';
import { HadithProviderClient } from '../integrations/islamic-content/hadith-provider.client.js';
import { IslamicContentOptions } from '../integrations/islamic-content/islamic-content-options.js';
import { QiblaProviderClient } from '../integrations/islamic-content/qibla-provider.client.js';
import { QuranProviderClient, type QuranProviderPayload } from '../integrations/islamic-content/quran-provider.client.js';
import { validateClientKey } from './api-clients/credentials.js';
import { contentProviders } from './islamic-content/providers.js';
import { HADITH_RECORD_COLUMNS, filterHadiths, isSupportedLanguage, toPublicHadith, type HadithRecordRow } from './public-content/hadith-query.js';
import { AYAH_COUNT, SHOWCASE_EDITIONS, ayahCacheKey, showcaseAyah, type AyahRecord } from './public-content/quran-showcase.js';

const COORDINATES_ERROR = 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.';
const DOUBLE_PATTERN = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const INT_PATTERN = /^\s*[+-]?\d+\s*$/;
const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
const QURAN_PREFIX = '/public/content/quran/';

/** {latitude:double} route constraint. */
function parseDoubleParam(value: string): number | null {
  return DOUBLE_PATTERN.test(value) ? Number(value) : null;
}

/** {number:int} route constraint. */
function parseIntParam(value: string): number | null {
  if (!INT_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return parsed >= INT32_MIN && parsed <= INT32_MAX ? parsed : null;
}

/** [FromQuery] binding is case-insensitive; repeated keys bind their first value. */
function queryValue(query: URLSearchParams, name: string): string | undefined {
  for (const [key, value] of query) if (key.toLowerCase() === name.toLowerCase()) return value;
  return undefined;
}

/** [FromQuery] int / int?: model-state error "The value 'x' is not valid." on bad input. */
function queryInt(query: URLSearchParams, name: string, errors: Record<string, string[]>): number | undefined {
  const raw = queryValue(query, name);
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = parseIntParam(raw);
  if (parsed === null) {
    errors[name] = [`The value '${raw}' is not valid.`];
    return undefined;
  }
  return parsed;
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildQiblaMetadata(): Record<string, unknown> {
  return {
    provider: QiblaProviderClient.providerName,
    providerOrganization: QiblaProviderClient.providerOrganization,
    selectedUpstreamServer: trimSlashes(IslamicContentOptions.requiredAlAdhanBaseUrl),
    officialServers: QiblaProviderClient.officialServers,
    serverSelection: 'The first server in the official AlAdhan OpenAPI document is required.',
    apiVersion: 'v1',
    openApiVersion: QiblaProviderClient.openApiVersion,
    openApiDocument: QiblaProviderClient.openApiDocumentUrl,
    endpointBase: '/public/content/qibla',
    routes: [
      {
        method: 'GET',
        path: '/public/content/qibla/{latitude}/{longitude}',
        mediaType: 'application/json',
        description: 'Qibla bearing plus MasjidHub metadata and a related compass URL.',
      },
      {
        method: 'GET',
        path: '/public/content/qibla/{latitude}/{longitude}/compass',
        mediaType: 'image/png',
        description: 'Generated compass image marking the Qibla direction.',
      },
    ],
    coordinates: {
      latitude: { minimum: -90, maximum: 90 },
      longitude: { minimum: -180, maximum: 180 },
      precision: 'Up to 6 decimal places are forwarded to the provider.',
    },
    direction: { unit: 'degrees', range: '0 <= direction < 360', convention: 'clockwise from north' },
    upstreamCompression: QiblaProviderClient.upstreamCompression,
    authentication: { required: true, header: 'X-IqamaTime-Client-Key', scope: 'content:read' },
    browserAccess: { crossOrigin: true, methods: ['GET', 'OPTIONS'], credentials: false },
  };
}

/**
 * ValidateClientAsync: administrators with a session pass; everyone else needs a
 * valid X-IqamaTime-Client-Key (or legacy X-DeenTime-Client-Key) with content:read.
 */
async function validateClient(c: Ctx): Promise<void> {
  const user = currentUser(c);
  if (user !== null && hasRole(user, 'Admin', 'admin', 'owner', 'SuperUser')) return;

  const validation = await validateClientKey(c, 'content:read');
  if (validation === null) {
    throw unauthorized({ error: 'A MasjidHub API client key is required.', header: 'X-IqamaTime-Client-Key', scope: 'content:read' });
  }
  if (!validation.isValid) throw unauthorized({ error: validation.error ?? 'The API client key is not authorized.' });
}

function providerFailure(error: unknown): unknown {
  return error instanceof IslamicContentProviderError ? serviceUnavailable({ error: error.message }) : error;
}

function sourceHeaders(source: string): Record<string, string> {
  return { 'X-IqamaTime-Source': source, 'X-DeenTime-Source': source };
}

/** ContentResult: the provider's JSON and status code, Content-Type passed through. */
function sendPayload(payload: QuranProviderPayload, headers: Record<string, string>): Response {
  const bodiless = payload.statusCode === 204 || payload.statusCode === 205 || payload.statusCode === 304;
  return new Response(bodiless ? null : payload.json, { status: payload.statusCode, headers: { ...headers, 'Content-Type': payload.contentType } });
}

function parseAyah(json: string | undefined): AyahRecord | null {
  if (json === undefined) return null;
  try {
    return showcaseAyah(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

function rows<T>(result: D1Result | undefined): T[] {
  return (result?.results ?? []) as T[];
}

/**
 * /public/content: the anonymous, rate-limited content API for masjid websites.
 * Every content route is gated by an organization API client key (or an admin session).
 * Port of backend-node/src/modules/public-content/public-content.controller.ts.
 *
 * Hadith and the edition catalogue are only read from D1 (the offline sync fills them).
 * Qibla and the Qur'an proxy make one provider request when the cache misses, as in
 * backend-node. The showcase routes read one small row per ayah instead of a cached
 * complete edition (see ./public-content/quran-showcase.ts).
 */
export function register(app: App): void {
  const limit = rateLimit('public');

  app.get('/public/content/capabilities', limit, (c) =>
    c.json({
      apiVersion: 'v1',
      authentication: {
        requiredForContent: true,
        header: 'X-IqamaTime-Client-Key',
        legacyHeader: 'X-DeenTime-Client-Key',
        scope: 'content:read',
        note: 'Administrators may use their MasjidHub session token; external masjid apps must send a client key.',
      },
      browserAccess: {
        crossOrigin: true,
        methods: ['GET', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'X-IqamaTime-Client-Key', 'X-DeenTime-Client-Key', 'Accept', 'Content-Type'],
        credentials: false,
        note: 'Masjid websites may call read-only content APIs from their own domain with a revocable client key.',
      },
      quran: {
        provider: 'AlQuran Cloud',
        upstreamServer: trimSlashes(IslamicContentOptions.requiredQuranBaseUrl),
        endpointBase: '/public/content/quran',
        endpointTemplates: QuranProviderClient.endpointTemplates,
        queryParameters: ['type', 'format', 'language', 'offset', 'limit'],
        showcaseRandom: '/public/content/quran/showcase/random',
        showcaseRecitation: '/public/content/quran/showcase/ayah/{number}/recitation/{edition}',
        behavior: 'Provider-compatible JSON with local caching and stale-data fallback',
      },
      qibla: buildQiblaMetadata(),
      hadith: {
        endpointBase: '/public/content/hadith',
        languages: HadithProviderClient.languages,
        routes: ['GET /books', 'GET /books/{bookSlug}/chapters', 'GET /hadiths', 'GET /hadiths/{providerId}', 'GET /hadiths/random'],
      },
    }),
  );

  app.get('/public/content/qibla/metadata', limit, (c) => c.json({ data: buildQiblaMetadata() }));

  app.get('/public/content/qibla/:latitude/:longitude', limit, async (c) => {
    const latitude = parseDoubleParam(c.req.param('latitude'));
    const longitude = parseDoubleParam(c.req.param('longitude'));
    if (latitude === null || longitude === null) throw notFound();
    await validateClient(c);
    if (!QiblaProviderClient.areValidCoordinates(latitude, longitude)) throw badRequest({ error: COORDINATES_ERROR });

    let payload;
    try {
      payload = await contentProviders(c).qibla.getDirection(latitude, longitude);
    } catch (error) {
      throw providerFailure(error);
    }

    const latitudePath = QiblaProviderClient.formatCoordinate(payload.data.latitude);
    const longitudePath = QiblaProviderClient.formatCoordinate(payload.data.longitude);
    const source = payload.fromCache ? 'cache' : 'provider';
    return c.json(
      {
        code: 200,
        status: 'OK',
        data: {
          latitude: payload.data.latitude,
          longitude: payload.data.longitude,
          direction: payload.data.direction,
          directionUnit: 'degrees',
          bearingConvention: 'clockwise from north',
          destination: { name: 'Al-Kaaba', city: 'Makkah', country: 'Saudi Arabia' },
          // Express `request.baseUrl` is empty for the root-mounted app: the URL is relative.
          compassUrl: `/public/content/qibla/${latitudePath}/${longitudePath}/compass`,
        },
        meta: {
          provider: QiblaProviderClient.providerName,
          providerOrganization: QiblaProviderClient.providerOrganization,
          apiVersion: 'v1',
          openApiVersion: QiblaProviderClient.openApiVersion,
          upstreamServer: trimSlashes(IslamicContentOptions.requiredAlAdhanBaseUrl),
          source,
          retrievedAtUtc: payload.retrievedAtUtc,
        },
      },
      200,
      { ...sourceHeaders(source), 'X-IqamaTime-Retrieved': payload.retrievedAtUtc.toISOString(), 'Cache-Control': 'private, max-age=86400' },
    );
  });

  /** Streams the provider's PNG; denials and validation errors stay JSON (never 406). */
  app.get('/public/content/qibla/:latitude/:longitude/compass', limit, async (c) => {
    const latitude = parseDoubleParam(c.req.param('latitude'));
    const longitude = parseDoubleParam(c.req.param('longitude'));
    if (latitude === null || longitude === null) throw notFound();
    await validateClient(c);
    if (!QiblaProviderClient.areValidCoordinates(latitude, longitude)) throw badRequest({ error: COORDINATES_ERROR });

    let payload;
    try {
      payload = await contentProviders(c).qibla.getCompass(latitude, longitude);
    } catch (error) {
      throw providerFailure(error);
    }
    return new Response(payload.content, {
      status: 200,
      headers: {
        ...sourceHeaders('provider'),
        'X-IqamaTime-Retrieved': payload.retrievedAtUtc.toISOString(),
        'Cache-Control': 'private, max-age=86400',
        'Content-Type': payload.contentType,
      },
    });
  });

  app.get('/public/content/quran/showcase/random', limit, async (c) => {
    await validateClient(c);
    const number = 1 + Math.floor(Math.random() * AYAH_COUNT);
    const keys = SHOWCASE_EDITIONS.map((identifier) => ayahCacheKey(number, identifier));
    const entries = await db(c).all<{ CacheKey: string; PayloadJson: string }>(
      `SELECT "CacheKey", "PayloadJson" FROM "IslamicContentCacheEntries" WHERE "Provider" = ? AND "CacheKey" IN (${keys.map(() => '?').join(', ')})`,
      QuranProviderClient.providerName,
      ...keys,
    );
    const payloads = new Map(entries.map((entry) => [entry.CacheKey, entry.PayloadJson]));
    const ayahs = keys.map((key) => parseAyah(payloads.get(key))).filter((ayah) => ayah !== null);
    if (ayahs.length === SHOWCASE_EDITIONS.length) return c.json({ code: 200, status: 'OK', data: ayahs }, 200, sourceHeaders('cache'));

    let fallback: QuranProviderPayload;
    try {
      fallback = await contentProviders(c).quran.get(`ayah/random/editions/${SHOWCASE_EDITIONS.join(',')}`);
    } catch (error) {
      throw providerFailure(error);
    }
    return sendPayload(fallback, sourceHeaders(fallback.fromCache ? 'cache' : 'provider'));
  });

  app.get('/public/content/quran/showcase/ayah/:number/recitation/:edition', limit, async (c) => {
    const number = parseIntParam(c.req.param('number'));
    if (number === null) throw notFound();
    await validateClient(c);
    if (number < 1 || number > AYAH_COUNT) throw badRequest({ error: 'Ayah number must be between 1 and 6236.' });

    const identifier = c.req.param('edition').trim();
    const database = db(c);
    const [editions, cached] = await database.batch([
      database.stmt(`SELECT "Identifier" FROM "QuranEditions" WHERE "Identifier" = ? AND "Format" = 'audio' LIMIT 1`, identifier),
      database.stmt(
        'SELECT "PayloadJson" FROM "IslamicContentCacheEntries" WHERE "Provider" = ? AND "CacheKey" = ?',
        QuranProviderClient.providerName,
        ayahCacheKey(number, identifier),
      ),
    ]);
    const audioEdition = rows<{ Identifier: string }>(editions)[0];
    if (audioEdition === undefined) throw badRequest({ error: "Choose a valid audio edition from the MasjidHub Qur'an catalogue." });

    const cachedAyah = parseAyah(rows<{ PayloadJson: string }>(cached)[0]?.PayloadJson);
    if (cachedAyah !== null) return c.json({ code: 200, status: 'OK', data: cachedAyah }, 200, sourceHeaders('cache'));

    let fallback: QuranProviderPayload;
    try {
      fallback = await contentProviders(c).quran.get(`ayah/${number}/${audioEdition.Identifier}`);
    } catch (error) {
      throw providerFailure(error);
    }
    return sendPayload(fallback, sourceHeaders(fallback.fromCache ? 'cache' : 'provider'));
  });

  /** Verbatim proxy of the documented AlQuran Cloud endpoints with caching and stale fallback. */
  app.get('/public/content/quran/*', limit, async (c) => {
    const url = new URL(c.req.url);
    // The wildcard keeps the caller's spelling; Express handed over the decoded segments.
    const rawPath = url.pathname.length > QURAN_PREFIX.length ? url.pathname.slice(QURAN_PREFIX.length) : '';
    if (rawPath.replace(/\/+$/, '').length === 0) throw notFound();
    await validateClient(c);

    let payload: QuranProviderPayload;
    try {
      let path: string;
      try {
        path = rawPath.split('/').map(decodeURIComponent).join('/');
      } catch {
        throw new ArgumentError('The requested path is not part of the documented AlQuran Cloud API.', 'path');
      }
      payload = await contentProviders(c).quran.get(path, url.searchParams);
    } catch (error) {
      if (error instanceof ArgumentError) throw badRequest({ error: error.message });
      throw providerFailure(error);
    }

    const headers = { ...sourceHeaders(payload.fromCache ? 'cache' : 'provider'), 'X-DeenTime-Retrieved': payload.retrievedAtUtc.toISOString() };
    return sendPayload(payload, payload.isStale ? { ...headers, Warning: '110 - Response is stale' } : headers);
  });

  app.get('/public/content/hadith/books', limit, async (c) => {
    await validateClient(c);
    const books = await db(c).all<{
      ProviderId: number;
      BookSlug: string;
      BookName: string;
      WriterName: string;
      AboutWriter: string | null;
      WriterDeath: string | null;
      HadithCount: number;
      ChapterCount: number;
      SyncedAtUtc: string;
    }>('SELECT * FROM "HadithBooks" ORDER BY "ProviderId"');
    const data = books.map((book) => ({
      id: book.ProviderId,
      slug: book.BookSlug,
      name: book.BookName,
      writerName: book.WriterName,
      aboutWriter: book.AboutWriter,
      writerDeath: book.WriterDeath,
      hadithCount: book.HadithCount,
      chapterCount: book.ChapterCount,
      languages: HadithProviderClient.languages,
      syncedAtUtc: book.SyncedAtUtc,
    }));
    return c.json({ data, total: data.length });
  });

  app.get('/public/content/hadith/books/:bookSlug/chapters', limit, async (c) => {
    await validateClient(c);
    const bookSlug = c.req.param('bookSlug');
    const database = db(c);
    const [book, chapterRows] = await database.batch([
      database.stmt('SELECT COUNT(*) AS "Total" FROM "HadithBooks" WHERE "BookSlug" = ?', bookSlug),
      database.stmt(
        'SELECT "ProviderId", "BookSlug", "ChapterNumber", "ChapterArabic", "ChapterEnglish", "ChapterUrdu" FROM "HadithChapters" WHERE "BookSlug" = ? ORDER BY "ChapterNumber"',
        bookSlug,
      ),
    ]);
    if ((rows<{ Total: number }>(book)[0]?.Total ?? 0) === 0) throw notFound({ error: 'Hadith book not found.' });

    const data = rows<{ ProviderId: number; BookSlug: string; ChapterNumber: number; ChapterArabic: string | null; ChapterEnglish: string | null; ChapterUrdu: string | null }>(chapterRows).map(
      (chapter) => ({
        id: chapter.ProviderId,
        bookSlug: chapter.BookSlug,
        chapterNumber: chapter.ChapterNumber,
        chapterArabic: chapter.ChapterArabic,
        chapterEnglish: chapter.ChapterEnglish,
        chapterUrdu: chapter.ChapterUrdu,
      }),
    );
    return c.json({ data, total: data.length });
  });

  app.get('/public/content/hadith/hadiths', limit, async (c) => {
    const query = new URL(c.req.url).searchParams;
    const errors: Record<string, string[]> = {};
    const chapter = queryInt(query, 'chapter', errors);
    const pageValue = queryInt(query, 'page', errors);
    const pageSizeValue = queryInt(query, 'pageSize', errors);
    if (Object.keys(errors).length > 0) throw validationProblem(errors);
    const book = queryValue(query, 'book');
    const status = queryValue(query, 'status');
    const search = queryValue(query, 'search');
    const language = queryValue(query, 'language');

    await validateClient(c);
    const page = Math.max(1, pageValue ?? 1);
    const pageSize = Math.min(100, Math.max(1, pageSizeValue ?? 20));
    if (search !== undefined && search.length > 200) throw badRequest({ error: 'Search is limited to 200 characters.' });
    if (!isSupportedLanguage(language)) throw badRequest({ error: 'Language must be ar, en, or ur.' });

    const filter = filterHadiths(book, chapter, status, search, language);
    const database = db(c);
    const [count, records] = await database.batch([
      database.stmt(`SELECT COUNT(*) AS "Total" FROM "HadithRecords"${filter.where}`, ...filter.params),
      database.stmt(
        `SELECT ${HADITH_RECORD_COLUMNS} FROM "HadithRecords"${filter.where} ORDER BY "BookSlug", "ProviderId" LIMIT ? OFFSET ?`,
        ...filter.params,
        pageSize,
        (page - 1) * pageSize,
      ),
    ]);
    return c.json(pagedResult(rows<HadithRecordRow>(records).map(toPublicHadith), page, pageSize, rows<{ Total: number }>(count)[0]?.Total ?? 0));
  });

  app.get('/public/content/hadith/hadiths/random', limit, async (c) => {
    const query = new URL(c.req.url).searchParams;
    const errors: Record<string, string[]> = {};
    const chapter = queryInt(query, 'chapter', errors);
    if (Object.keys(errors).length > 0) throw validationProblem(errors);
    const book = queryValue(query, 'book');
    const status = queryValue(query, 'status');
    const language = queryValue(query, 'language');

    await validateClient(c);
    if (!isSupportedLanguage(language)) throw badRequest({ error: 'Language must be ar, en, or ur.' });

    // One query: the random offset is drawn inside SQLite from the number of matching rows.
    const filter = filterHadiths(book, chapter, status, undefined, language);
    const record = await db(c).first<HadithRecordRow>(
      `SELECT ${HADITH_RECORD_COLUMNS} FROM "HadithRecords"${filter.where} ORDER BY "ProviderId" LIMIT 1
       OFFSET (SELECT (RANDOM() & 2147483647) % MAX(COUNT(*), 1) FROM "HadithRecords"${filter.where})`,
      ...filter.params,
      ...filter.params,
    );
    if (record === null) throw notFound({ error: 'No hadith matched the requested filters.' });
    return c.json({ data: toPublicHadith(record) });
  });

  app.get('/public/content/hadith/hadiths/:providerId', limit, async (c) => {
    const providerId = parseIntParam(c.req.param('providerId'));
    if (providerId === null) throw notFound();
    await validateClient(c);
    const record = await db(c).first<HadithRecordRow>(`SELECT ${HADITH_RECORD_COLUMNS} FROM "HadithRecords" WHERE "ProviderId" = ? LIMIT 1`, providerId);
    if (record === null) throw notFound({ error: 'Hadith not found.' });
    return c.json({ data: toPublicHadith(record) });
  });
}
