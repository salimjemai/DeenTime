import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type IslamicContentCacheEntry } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ArgumentError, IslamicContentProviderError } from './errors.js';
import { IslamicContentOptions } from './islamic-content-options.js';
import {
  PROVIDER_CLIENT_OPTIONS,
  classifyFetchError,
  ensureTrailingSlash,
  escapeDataString,
  requestSignal,
  resolveClock,
  resolveFetch,
  type ProviderClientOptions,
} from './provider-http.js';

export interface QuranProviderPayload {
  json: string;
  contentType: string;
  statusCode: number;
  fromCache: boolean;
  isStale: boolean;
  retrievedAtUtc: Date;
}

/** Query string pairs as received by the controller (repeated keys allowed). */
export type QueryPairs = Iterable<readonly [key: string, value: string | null | undefined]>;

export interface QuranRequest {
  /** Trimmed path without surrounding slashes, e.g. "surah/1/en.sahih". */
  path: string;
  /** "" or "?key=value&..." with lower-cased keys sorted by key then value. */
  queryString: string;
  /** Escaped path + query string, relative to the provider base URL. */
  relativeUri: string;
  /** "/path?query" — the IslamicContentCacheEntry.cacheKey. */
  cacheKey: string;
  /** ayah/random* responses are never cached. */
  isRandom: boolean;
}

const ENDPOINT_TEMPLATES: readonly string[] = [
  '/ayah/random',
  '/ayah/random/{edition}',
  '/ayah/random/editions/{editions}',
  '/ayah/{number}',
  '/ayah/{number}/{edition}',
  '/ayah/{number}/editions/{editions}',
  '/edition',
  '/edition/type',
  '/edition/type/{type}',
  '/edition/format',
  '/edition/format/{format}',
  '/edition/language',
  '/edition/language/{lang}',
  '/hizbQuarter/{number}',
  '/hizbQuarter/{number}/{edition}',
  '/juz/{number}',
  '/juz/{number}/{edition}',
  '/manzil/{number}',
  '/manzil/{number}/{edition}',
  '/meta',
  '/page/{number}',
  '/page/{number}/{edition}',
  '/quran',
  '/quran/{edition}',
  '/ruku/{number}',
  '/ruku/{number}/{edition}',
  '/sajda',
  '/sajda/{edition}',
  '/search/{word}',
  '/search/{word}/{surah}',
  '/search/{word}/{surah}/{language}',
  '/surah',
  '/surah/{number}',
  '/surah/{number}/{edition}',
  '/surah/{number}/editions/{editions}',
];

// .NET \d matches any Unicode decimal digit; the anchors and IgnoreCase mirror PathRegex().
const DIGITS = '\\p{Nd}+';
const ALLOWED_PATHS: readonly RegExp[] = [
  'ayah/random',
  'ayah/random/[^/]+',
  'ayah/random/editions/[^/]+',
  `ayah/${DIGITS}`,
  `ayah/${DIGITS}/[^/]+`,
  `ayah/${DIGITS}/editions/[^/]+`,
  'edition',
  'edition/(?:type|format|language)',
  'edition/(?:type|format|language)/[^/]+',
  `(?:hizbQuarter|juz|manzil|page|ruku)/${DIGITS}`,
  `(?:hizbQuarter|juz|manzil|page|ruku)/${DIGITS}/[^/]+`,
  'meta',
  'quran',
  'quran/[^/]+',
  'sajda',
  'sajda/[^/]+',
  'search/[^/]+',
  `search/[^/]+/(?:all|${DIGITS})`,
  `search/[^/]+/(?:all|${DIGITS})/[^/]+`,
  'surah',
  `surah/${DIGITS}`,
  `surah/${DIGITS}/[^/]+`,
  `surah/${DIGITS}/editions/[^/]+`,
].map((expression) => new RegExp(`^(?:${expression})$`, 'iu'));

const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set(['type', 'format', 'language', 'offset', 'limit']);
const QUERY_VALUE_PATTERN = /^[\p{L}\p{N}._-]+$/u;
const INTEGER_PATTERN = /^[+-]?\d+$/;
const UPSTREAM_ERROR_BODY = '{"code":502,"status":"UPSTREAM ERROR"}';

/** QuranProviderClient.NormalizePath: null when the path is unusable. */
export function normalizeQuranPath(path: string | null | undefined): string | null {
  if (path === null || path === undefined || path.trim().length === 0 || path.length > 500) return null;
  const normalized = path.trim().replace(/^\/+|\/+$/g, '');
  if (normalized.length === 0 || normalized.includes('\\') || normalized.includes('?') || normalized.includes('#')) return null;
  if (/\p{Cc}/u.test(normalized)) return null;
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..' || segment.length === 0)) return null;
  return normalized;
}

function isAllowedPath(normalizedPath: string): boolean {
  return ALLOWED_PATHS.some((regex) => regex.test(normalizedPath));
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * QuranProviderClient.NormalizeQuery: keeps the documented keys only (case-insensitive),
 * validates values, lower-cases keys, sorts by key then value and escapes both.
 * Throws ArgumentError with the .NET messages on invalid values.
 */
export function normalizeQuranQuery(query?: QueryPairs | null): string {
  if (!query) return '';
  const parameters: Array<[string, string]> = [];
  for (const [key, rawValue] of query) {
    if (!ALLOWED_QUERY_KEYS.has(key.toLowerCase()) || rawValue === null || rawValue === undefined || rawValue.trim().length === 0) continue;
    const value = rawValue.trim();
    if (value.length > 100) throw new ArgumentError(`Query parameter '${key}' is too long.`);

    const lowered = key.toLowerCase();
    if (lowered === 'offset' || lowered === 'limit') {
      const number = INTEGER_PATTERN.test(value) ? Number(value) : Number.NaN;
      if (!Number.isFinite(number) || number < 0 || number > 10000) {
        throw new ArgumentError(`Query parameter '${key}' must be between 0 and 10000.`);
      }
    } else if (!QUERY_VALUE_PATTERN.test(value)) {
      throw new ArgumentError(`Query parameter '${key}' contains unsupported characters.`);
    }
    parameters.push([lowered, value]);
  }
  if (parameters.length === 0) return '';
  parameters.sort((left, right) => ordinalCompare(left[0], right[0]) || ordinalCompare(left[1], right[1]));
  return '?' + parameters.map(([key, value]) => `${escapeDataString(key)}=${escapeDataString(value)}`).join('&');
}

function escapePath(path: string): string {
  return path.split('/').map(escapeDataString).join('/');
}

/** Validates and canonicalizes a request; throws ArgumentError for undocumented paths or bad query values. */
export function canonicalizeQuranRequest(path: string, query?: QueryPairs | null): QuranRequest {
  const normalized = normalizeQuranPath(path);
  if (normalized === null || !isAllowedPath(normalized)) {
    throw new ArgumentError('The requested path is not part of the documented AlQuran Cloud API.', 'path');
  }
  const queryString = normalizeQuranQuery(query);
  return {
    path: normalized,
    queryString,
    relativeUri: escapePath(normalized) + queryString,
    cacheKey: '/' + normalized + queryString,
    isRandom: normalized.toLowerCase().startsWith('ayah/random'),
  };
}

type CachedEntry = Pick<IslamicContentCacheEntry, 'payloadJson' | 'contentType' | 'retrievedAtUtc' | 'expiresAtUtc'>;

function fromCache(entry: CachedEntry, isStale: boolean): QuranProviderPayload {
  return {
    json: JSON.stringify(entry.payloadJson),
    contentType: entry.contentType,
    statusCode: 200,
    fromCache: true,
    isStale,
    retrievedAtUtc: entry.retrievedAtUtc,
  };
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new IslamicContentProviderError("The Qur'an provider returned an invalid response.", { cause: error });
  }
}

function toInputJson(payload: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return payload === null ? Prisma.JsonNull : (payload as Prisma.InputJsonValue);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Typed client for https://api.alquran.cloud/v1/ (3 minute timeout, UA DeenTime/1.0)
 * with the database-backed payload cache from QuranProviderClient.cs.
 */
@Injectable()
export class QuranProviderClient {
  static readonly providerName = 'alquran-cloud';
  static readonly endpointTemplates: readonly string[] = ENDPOINT_TEMPLATES;
  static readonly allowedQueryKeys: readonly string[] = [...ALLOWED_QUERY_KEYS];
  private static readonly timeoutMs = 3 * 60_000;

  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaService,
    private readonly options: IslamicContentOptions,
    @Optional() @Inject(PROVIDER_CLIENT_OPTIONS) clientOptions?: ProviderClientOptions,
  ) {
    this.fetch = resolveFetch(clientOptions);
    this.baseUrl = ensureTrailingSlash(clientOptions?.baseUrl ?? options.quranBaseUrl);
    this.now = resolveClock(clientOptions);
  }

  static isDocumentedPath(path: string): boolean {
    const normalized = normalizeQuranPath(path);
    return normalized !== null && isAllowedPath(normalized);
  }

  /**
   * Returns the provider JSON for a documented path: a fresh cache hit when available,
   * otherwise the upstream response (cached on success), the stale cache when the
   * provider fails, or the upstream error body. Throws ArgumentError for undocumented
   * paths and IslamicContentProviderError when the provider is unreachable with no cache.
   */
  async get(path: string, query?: QueryPairs | null, forceRefresh = false, signal?: AbortSignal): Promise<QuranProviderPayload> {
    const request = canonicalizeQuranRequest(path, query);

    let cached: CachedEntry | null = null;
    if (!request.isRandom) {
      cached = await this.findCached(request.cacheKey);
      if (!forceRefresh && cached !== null && cached.expiresAtUtc.getTime() > this.now().getTime()) return fromCache(cached, false);
    }

    let response: Response;
    let json: string;
    try {
      response = await this.fetch(this.baseUrl + request.relativeUri, {
        headers: { 'User-Agent': 'DeenTime/1.0' },
        signal: requestSignal(QuranProviderClient.timeoutMs, signal),
      });
      json = await response.text();
    } catch (error) {
      const failure = classifyFetchError(error);
      if (failure === null || failure === 'aborted') throw error;
      if (cached !== null) return fromCache(cached, true);
      throw new IslamicContentProviderError("The Qur'an content provider is currently unavailable.", { cause: error });
    }

    const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';
    if (response.ok) {
      const payload = parseJson(json);
      const retrievedAt = this.now();
      if (!request.isRandom) await this.upsertCache(request.cacheKey, json, payload, contentType, retrievedAt);
      return { json, contentType, statusCode: response.status, fromCache: false, isStale: false, retrievedAtUtc: retrievedAt };
    }

    if (cached !== null) return fromCache(cached, true);
    return {
      json: json.trim().length === 0 ? UPSTREAM_ERROR_BODY : json,
      contentType,
      statusCode: response.status,
      fromCache: false,
      isStale: false,
      retrievedAtUtc: this.now(),
    };
  }

  private async findCached(cacheKey: string): Promise<CachedEntry | null> {
    return this.prisma.islamicContentCacheEntry.findUnique({
      where: { provider_cacheKey: { provider: QuranProviderClient.providerName, cacheKey } },
      select: { payloadJson: true, contentType: true, retrievedAtUtc: true, expiresAtUtc: true },
    });
  }

  private async upsertCache(cacheKey: string, json: string, payload: unknown, contentType: string, retrievedAt: Date): Promise<void> {
    const provider = QuranProviderClient.providerName;
    const cacheDays = Math.min(365, Math.max(1, this.options.quranCacheDays));
    const data = {
      payloadJson: toInputJson(payload),
      payloadBytes: BigInt(Buffer.byteLength(json, 'utf8')),
      contentType: contentType.slice(0, 80),
      retrievedAtUtc: retrievedAt,
      expiresAtUtc: new Date(retrievedAt.getTime() + cacheDays * 86_400_000),
    };
    try {
      await this.prisma.islamicContentCacheEntry.upsert({
        where: { provider_cacheKey: { provider, cacheKey } },
        create: { id: randomUUID(), provider, cacheKey, ...data },
        update: data,
      });
    } catch (error) {
      // A concurrent request inserted the same key first: overwrite its row like the .NET retry.
      if (!isUniqueViolation(error)) throw error;
      const updated = await this.prisma.islamicContentCacheEntry.updateMany({ where: { provider, cacheKey }, data });
      if (updated.count === 0) throw error;
    }
  }
}
