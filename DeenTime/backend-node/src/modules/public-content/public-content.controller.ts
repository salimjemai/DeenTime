import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AllowAnonymous } from '../../common/auth/authorize.decorator.js';
import { hasRole, type AuthenticatedRequest } from '../../common/auth/claims.js';
import { badRequest, notFound, serviceUnavailable, unauthorized, validationProblem } from '../../common/errors.js';
import { pagedResult, type PagedResult } from '../../common/paged-result.js';
import { RateLimit } from '../../common/rate-limit.js';
import type { HadithRecord, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ArgumentError, IslamicContentProviderError } from '../../integrations/islamic-content/errors.js';
import { HadithProviderClient } from '../../integrations/islamic-content/hadith-provider.client.js';
import { IslamicContentOptions } from '../../integrations/islamic-content/islamic-content-options.js';
import { QiblaProviderClient } from '../../integrations/islamic-content/qibla-provider.client.js';
import { QuranProviderClient, type QuranProviderPayload } from '../../integrations/islamic-content/quran-provider.client.js';
import { ApiClientCredentialService } from '../api-clients/api-client-credential.service.js';
import { AYAH_COUNT, findAyah } from './quran-showcase.js';

/** PublicHadithRecord: `id` is the provider's hadith id. */
export interface PublicHadithRecord {
  id: number;
  hadithNumber: string;
  bookSlug: string;
  chapterNumber: number | null;
  volume: number | null;
  status: string | null;
  englishNarrator: string | null;
  urduNarrator: string | null;
  hadithEnglish: string | null;
  hadithUrdu: string | null;
  hadithArabic: string | null;
  headingEnglish: string | null;
  headingUrdu: string | null;
  headingArabic: string | null;
  syncedAtUtc: Date;
}

type HadithLanguageField = 'hadithArabic' | 'hadithEnglish' | 'hadithUrdu';
type QueryBag = Record<string, unknown>;

const COORDINATES_ERROR = 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.';
const SHOWCASE_EDITIONS = ['quran-uthmani', 'en.sahih', 'ar.alafasy'];
const DOUBLE_PATTERN = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const INT_PATTERN = /^\s*[+-]?\d+\s*$/;
const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;

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
function queryValue(query: QueryBag, name: string): string | undefined {
  const key = Object.keys(query).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? undefined : query[key];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' ? single : undefined;
}

/** [FromQuery] int / int?: model-state error "The value 'x' is not valid." on bad input. */
function queryInt(query: QueryBag, name: string, errors: Record<string, string[]>): number | undefined {
  const raw = queryValue(query, name);
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = parseIntParam(raw);
  if (parsed === null) {
    errors[name] = [`The value '${raw}' is not valid.`];
    return undefined;
  }
  return parsed;
}

/** Every query pair, expanding repeated keys (Request.Query). */
function queryPairs(query: QueryBag): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) if (typeof item === 'string') pairs.push([key, item]);
  }
  return pairs;
}

function headerValue(request: AuthenticatedRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isSupportedLanguage(language: string | undefined): boolean {
  return language === undefined || language.trim().length === 0 || HadithProviderClient.languages.some((item) => item === language.toLowerCase());
}

function nonEmpty(field: HadithLanguageField): Prisma.HadithRecordWhereInput {
  return { AND: [{ [field]: { not: null } }, { [field]: { not: '' } }] };
}

function ilike(field: HadithLanguageField | 'englishNarrator', term: string): Prisma.HadithRecordWhereInput {
  return { [field]: { contains: term, mode: 'insensitive' } };
}

/** FilterHadiths: book/chapter/status equality, language presence and ILIKE search. */
function filterHadiths(book: string | undefined, chapter: number | undefined, status: string | undefined, search: string | undefined, language: string | undefined): Prisma.HadithRecordWhereInput {
  const conditions: Prisma.HadithRecordWhereInput[] = [];
  if (book?.trim()) conditions.push({ bookSlug: book });
  if (chapter !== undefined) conditions.push({ chapterNumber: chapter });
  if (status?.trim()) conditions.push({ status });

  const lang = language?.toLowerCase();
  if (lang === 'ar') conditions.push(nonEmpty('hadithArabic'));
  else if (lang === 'ur') conditions.push(nonEmpty('hadithUrdu'));
  else if (lang === 'en') conditions.push(nonEmpty('hadithEnglish'));

  if (search?.trim()) {
    const term = search.trim();
    if (lang === 'ar') conditions.push(ilike('hadithArabic', term));
    else if (lang === 'ur') conditions.push(ilike('hadithUrdu', term));
    else if (lang === 'en') conditions.push(ilike('hadithEnglish', term));
    else conditions.push({ OR: [ilike('hadithArabic', term), ilike('hadithEnglish', term), ilike('hadithUrdu', term), ilike('englishNarrator', term)] });
  }
  return conditions.length === 0 ? {} : { AND: conditions };
}

function toPublicHadith(record: HadithRecord): PublicHadithRecord {
  return {
    id: record.providerId,
    hadithNumber: record.hadithNumber,
    bookSlug: record.bookSlug,
    chapterNumber: record.chapterNumber,
    volume: record.volume,
    status: record.status,
    englishNarrator: record.englishNarrator,
    urduNarrator: record.urduNarrator,
    hadithEnglish: record.hadithEnglish,
    hadithUrdu: record.hadithUrdu,
    hadithArabic: record.hadithArabic,
    headingEnglish: record.headingEnglish,
    headingUrdu: record.headingUrdu,
    headingArabic: record.headingArabic,
    syncedAtUtc: record.syncedAtUtc,
  };
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
        description: 'Qibla bearing plus IqamaTime metadata and a related compass URL.',
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
 * /public/content: the anonymous, rate-limited content API for masjid websites.
 * Every content route is gated by an organization API client key (or an admin
 * session), exactly like PublicIslamicContentController.cs.
 */
@Controller('public/content')
@AllowAnonymous()
@RateLimit('public')
export class PublicContentController {
  constructor(
    private readonly quranClient: QuranProviderClient,
    private readonly qiblaClient: QiblaProviderClient,
    private readonly prisma: PrismaService,
    private readonly credentials: ApiClientCredentialService,
  ) {}

  @Get('capabilities')
  capabilities() {
    return {
      apiVersion: 'v1',
      authentication: {
        requiredForContent: true,
        header: 'X-IqamaTime-Client-Key',
        legacyHeader: 'X-DeenTime-Client-Key',
        scope: 'content:read',
        note: 'Administrators may use their IqamaTime session token; external masjid apps must send a client key.',
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
    };
  }

  @Get('qibla/metadata')
  qiblaMetadata() {
    return { data: buildQiblaMetadata() };
  }

  @Get('qibla/:latitude/:longitude')
  async qiblaDirection(
    @Param('latitude') latitudeParam: string,
    @Param('longitude') longitudeParam: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const latitude = parseDoubleParam(latitudeParam);
    const longitude = parseDoubleParam(longitudeParam);
    if (latitude === null || longitude === null) throw notFound();
    await this.validateClient(request);
    if (!QiblaProviderClient.areValidCoordinates(latitude, longitude)) throw badRequest({ error: COORDINATES_ERROR });

    let payload;
    try {
      payload = await this.qiblaClient.getDirection(latitude, longitude);
    } catch (error) {
      throw this.providerFailure(error);
    }

    const latitudePath = QiblaProviderClient.formatCoordinate(payload.data.latitude);
    const longitudePath = QiblaProviderClient.formatCoordinate(payload.data.longitude);
    const source = payload.fromCache ? 'cache' : 'provider';
    this.setSourceHeader(response, source);
    response.setHeader('X-IqamaTime-Retrieved', payload.retrievedAtUtc.toISOString());
    response.setHeader('Cache-Control', 'private, max-age=86400');

    return {
      code: 200,
      status: 'OK',
      data: {
        latitude: payload.data.latitude,
        longitude: payload.data.longitude,
        direction: payload.data.direction,
        directionUnit: 'degrees',
        bearingConvention: 'clockwise from north',
        destination: { name: 'Al-Kaaba', city: 'Makkah', country: 'Saudi Arabia' },
        compassUrl: `${request.baseUrl}/public/content/qibla/${latitudePath}/${longitudePath}/compass`,
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
    };
  }

  /** Streams the provider's PNG; denials and validation errors stay JSON (never 406). */
  @Get('qibla/:latitude/:longitude/compass')
  async qiblaCompass(
    @Param('latitude') latitudeParam: string,
    @Param('longitude') longitudeParam: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const latitude = parseDoubleParam(latitudeParam);
    const longitude = parseDoubleParam(longitudeParam);
    if (latitude === null || longitude === null) throw notFound();
    await this.validateClient(request);
    if (!QiblaProviderClient.areValidCoordinates(latitude, longitude)) throw badRequest({ error: COORDINATES_ERROR });

    let payload;
    try {
      payload = await this.qiblaClient.getCompass(latitude, longitude);
    } catch (error) {
      throw this.providerFailure(error);
    }
    this.setSourceHeader(response, 'provider');
    response.setHeader('X-IqamaTime-Retrieved', payload.retrievedAtUtc.toISOString());
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.status(200).setHeader('Content-Type', payload.contentType).send(payload.content);
  }

  @Get('quran/showcase/random')
  async cachedRandomAyah(@Req() request: AuthenticatedRequest, @Res() response: Response): Promise<void> {
    await this.validateClient(request);
    const keys = SHOWCASE_EDITIONS.map((identifier) => `/quran/${identifier}`);
    const entries = await this.prisma.islamicContentCacheEntry.findMany({
      where: { provider: QuranProviderClient.providerName, cacheKey: { in: keys } },
      select: { cacheKey: true, payloadJson: true },
    });
    const payloads = new Map(entries.map((entry) => [entry.cacheKey, entry.payloadJson]));

    if (payloads.size === SHOWCASE_EDITIONS.length) {
      const number = 1 + Math.floor(Math.random() * AYAH_COUNT);
      const ayahs = keys.map((key) => findAyah(payloads.get(key), number)).filter((ayah) => ayah !== null);
      if (ayahs.length === SHOWCASE_EDITIONS.length) {
        this.setSourceHeader(response, 'cache');
        response.status(200).json({ code: 200, status: 'OK', data: ayahs });
        return;
      }
    }

    let fallback: QuranProviderPayload;
    try {
      fallback = await this.quranClient.get('ayah/random/editions/quran-uthmani,en.sahih,ar.alafasy');
    } catch (error) {
      throw this.providerFailure(error);
    }
    this.setSourceHeader(response, fallback.fromCache ? 'cache' : 'provider');
    this.sendPayload(response, fallback);
  }

  @Get('quran/showcase/ayah/:number/recitation/:edition')
  async cachedAyahRecitation(
    @Param('number') numberParam: string,
    @Param('edition') edition: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const number = parseIntParam(numberParam);
    if (number === null) throw notFound();
    await this.validateClient(request);
    if (number < 1 || number > AYAH_COUNT) throw badRequest({ error: 'Ayah number must be between 1 and 6236.' });

    const identifier = edition.trim();
    const audioEdition = await this.prisma.quranEdition.findFirst({ where: { identifier, format: 'audio' }, select: { identifier: true } });
    if (audioEdition === null) throw badRequest({ error: "Choose a valid audio edition from the IqamaTime Qur'an catalogue." });

    const cached = await this.prisma.islamicContentCacheEntry.findUnique({
      where: { provider_cacheKey: { provider: QuranProviderClient.providerName, cacheKey: `/quran/${audioEdition.identifier}` } },
      select: { payloadJson: true },
    });
    const cachedAyah = cached === null ? null : findAyah(cached.payloadJson, number);
    if (cachedAyah !== null) {
      this.setSourceHeader(response, 'cache');
      response.status(200).json({ code: 200, status: 'OK', data: cachedAyah });
      return;
    }

    let fallback: QuranProviderPayload;
    try {
      fallback = await this.quranClient.get(`ayah/${number}/${audioEdition.identifier}`);
    } catch (error) {
      throw this.providerFailure(error);
    }
    this.setSourceHeader(response, fallback.fromCache ? 'cache' : 'provider');
    this.sendPayload(response, fallback);
  }

  /** Verbatim proxy of the documented AlQuran Cloud endpoints with caching and stale fallback. */
  @Get('quran/*path')
  async quran(@Param('path') pathParam: string | string[], @Req() request: AuthenticatedRequest, @Res() response: Response): Promise<void> {
    await this.validateClient(request);
    const path = Array.isArray(pathParam) ? pathParam.join('/') : String(pathParam ?? '');

    let payload: QuranProviderPayload;
    try {
      payload = await this.quranClient.get(path, queryPairs(request.query as QueryBag));
    } catch (error) {
      if (error instanceof ArgumentError) throw badRequest({ error: error.message });
      throw this.providerFailure(error);
    }

    this.setSourceHeader(response, payload.fromCache ? 'cache' : 'provider');
    response.setHeader('X-DeenTime-Retrieved', payload.retrievedAtUtc.toISOString());
    if (payload.isStale) response.setHeader('Warning', '110 - Response is stale');
    this.sendPayload(response, payload);
  }

  @Get('hadith/books')
  async books(@Req() request: AuthenticatedRequest) {
    await this.validateClient(request);
    const books = await this.prisma.hadithBook.findMany({ orderBy: { providerId: 'asc' } });
    const data = books.map((book) => ({
      id: book.providerId,
      slug: book.bookSlug,
      name: book.bookName,
      writerName: book.writerName,
      aboutWriter: book.aboutWriter,
      writerDeath: book.writerDeath,
      hadithCount: book.hadithCount,
      chapterCount: book.chapterCount,
      languages: HadithProviderClient.languages,
      syncedAtUtc: book.syncedAtUtc,
    }));
    return { data, total: data.length };
  }

  @Get('hadith/books/:bookSlug/chapters')
  async chapters(@Param('bookSlug') bookSlug: string, @Req() request: AuthenticatedRequest) {
    await this.validateClient(request);
    const bookCount = await this.prisma.hadithBook.count({ where: { bookSlug } });
    if (bookCount === 0) throw notFound({ error: 'Hadith book not found.' });

    const chapters = await this.prisma.hadithChapter.findMany({ where: { bookSlug }, orderBy: { chapterNumber: 'asc' } });
    const data = chapters.map((chapter) => ({
      id: chapter.providerId,
      bookSlug: chapter.bookSlug,
      chapterNumber: chapter.chapterNumber,
      chapterArabic: chapter.chapterArabic,
      chapterEnglish: chapter.chapterEnglish,
      chapterUrdu: chapter.chapterUrdu,
    }));
    return { data, total: data.length };
  }

  @Get('hadith/hadiths')
  async hadiths(@Query() query: QueryBag, @Req() request: AuthenticatedRequest): Promise<PagedResult<PublicHadithRecord>> {
    const errors: Record<string, string[]> = {};
    const chapter = queryInt(query, 'chapter', errors);
    const pageValue = queryInt(query, 'page', errors);
    const pageSizeValue = queryInt(query, 'pageSize', errors);
    if (Object.keys(errors).length > 0) throw validationProblem(errors);
    const book = queryValue(query, 'book');
    const status = queryValue(query, 'status');
    const search = queryValue(query, 'search');
    const language = queryValue(query, 'language');

    await this.validateClient(request);
    const page = Math.max(1, pageValue ?? 1);
    const pageSize = Math.min(100, Math.max(1, pageSizeValue ?? 20));
    if (search !== undefined && search.length > 200) throw badRequest({ error: 'Search is limited to 200 characters.' });
    if (!isSupportedLanguage(language)) throw badRequest({ error: 'Language must be ar, en, or ur.' });

    const where = filterHadiths(book, chapter, status, search, language);
    const [total, records] = await Promise.all([
      this.prisma.hadithRecord.count({ where }),
      this.prisma.hadithRecord.findMany({ where, orderBy: [{ bookSlug: 'asc' }, { providerId: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return pagedResult(records.map(toPublicHadith), page, pageSize, total);
  }

  @Get('hadith/hadiths/random')
  async randomHadith(@Query() query: QueryBag, @Req() request: AuthenticatedRequest) {
    const errors: Record<string, string[]> = {};
    const chapter = queryInt(query, 'chapter', errors);
    if (Object.keys(errors).length > 0) throw validationProblem(errors);
    const book = queryValue(query, 'book');
    const status = queryValue(query, 'status');
    const language = queryValue(query, 'language');

    await this.validateClient(request);
    if (!isSupportedLanguage(language)) throw badRequest({ error: 'Language must be ar, en, or ur.' });

    const where = filterHadiths(book, chapter, status, undefined, language);
    const total = await this.prisma.hadithRecord.count({ where });
    if (total === 0) throw notFound({ error: 'No hadith matched the requested filters.' });

    const offset = Math.floor(Math.random() * total);
    const record = await this.prisma.hadithRecord.findFirst({ where, orderBy: { providerId: 'asc' }, skip: offset });
    if (record === null) throw notFound({ error: 'No hadith matched the requested filters.' });
    return { data: toPublicHadith(record) };
  }

  @Get('hadith/hadiths/:providerId')
  async hadith(@Param('providerId') providerIdParam: string, @Req() request: AuthenticatedRequest) {
    const providerId = parseIntParam(providerIdParam);
    if (providerId === null) throw notFound();
    await this.validateClient(request);
    const record = await this.prisma.hadithRecord.findFirst({ where: { providerId } });
    if (record === null) throw notFound({ error: 'Hadith not found.' });
    return { data: toPublicHadith(record) };
  }

  /**
   * ValidateClientAsync: administrators with a session pass; everyone else needs a
   * valid X-IqamaTime-Client-Key (or legacy X-DeenTime-Client-Key) with content:read.
   */
  private async validateClient(request: AuthenticatedRequest): Promise<void> {
    const user = request.user ?? null;
    if (user !== null && hasRole(user, 'Admin', 'admin', 'owner', 'SuperUser')) return;

    let key = headerValue(request, 'x-iqamatime-client-key');
    if (!key?.trim()) key = headerValue(request, 'x-deentime-client-key');
    if (!key?.trim()) {
      throw unauthorized({ error: 'An IqamaTime API client key is required.', header: 'X-IqamaTime-Client-Key', scope: 'content:read' });
    }

    const validation = await this.credentials.validate(key, 'content:read', request.path);
    if (!validation.isValid) throw unauthorized({ error: validation.error ?? 'The API client key is not authorized.' });
  }

  private providerFailure(error: unknown): unknown {
    return error instanceof IslamicContentProviderError ? serviceUnavailable({ error: error.message }) : error;
  }

  private setSourceHeader(response: Response, source: string): void {
    response.setHeader('X-IqamaTime-Source', source);
    response.setHeader('X-DeenTime-Source', source);
  }

  /** ContentResult: the provider's JSON and status code, Content-Type passed through untouched. */
  private sendPayload(response: Response, payload: QuranProviderPayload): void {
    response.status(payload.statusCode).setHeader('Content-Type', payload.contentType).send(Buffer.from(payload.json, 'utf8'));
  }
}
