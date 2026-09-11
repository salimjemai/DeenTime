import { Inject, Injectable, Optional } from '@nestjs/common';
import { ArgumentError, IslamicContentProviderError } from './errors.js';
import { IslamicContentOptions } from './islamic-content-options.js';
import {
  PROVIDER_CLIENT_OPTIONS,
  classifyFetchError,
  delay as realDelay,
  ensureTrailingSlash,
  escapeDataString,
  httpStatusName,
  requestSignal,
  resolveClock,
  resolveFetch,
  type ProviderClientOptions,
} from './provider-http.js';

export interface HadithProviderBook {
  id: number;
  slug: string;
  name: string;
  writerName: string;
  aboutWriter: string | null;
  writerDeath: string | null;
  hadithCount: number;
  chapterCount: number;
}

export interface HadithProviderChapter {
  id: number;
  bookSlug: string;
  chapterNumber: number;
  arabic: string | null;
  english: string | null;
  urdu: string | null;
}

export interface HadithProviderRecord {
  id: number;
  hadithNumber: string;
  bookSlug: string;
  chapterNumber: number | null;
  volume: number | null;
  status: string | null;
  englishNarrator: string | null;
  urduNarrator: string | null;
  english: string | null;
  urdu: string | null;
  arabic: string | null;
  headingEnglish: string | null;
  headingUrdu: string | null;
  headingArabic: string | null;
}

export interface HadithProviderPage {
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
  records: HadithProviderRecord[];
}

const RETRY = Symbol('retry');
type AttemptOutcome = { document: unknown } | typeof RETRY;

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;
const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** TryFindProperty: case-insensitive property lookup; undefined when absent (JSON null counts as absent). */
export function findHadithProperty(element: unknown, name: string): unknown {
  const object = asObject(element);
  if (object === null) return undefined;
  const lowered = name.toLowerCase();
  for (const key of Object.keys(object)) {
    if (key.toLowerCase() === lowered) return object[key] ?? undefined;
  }
  return undefined;
}

/** FindArray: `root[name]` when it is an array, else `root.data[name]`, else []. */
export function findHadithArray(root: unknown, name: string): unknown[] {
  const direct = findHadithProperty(root, name);
  if (Array.isArray(direct)) return direct;
  const data = findHadithProperty(root, 'data');
  if (asObject(data) !== null) {
    const nested = findHadithProperty(data, name);
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/** GetString: the first present property among `names`, as JsonElement.ToString() would render it. */
export function getHadithString(element: unknown, ...names: string[]): string | null {
  for (const name of names) {
    const value = findHadithProperty(element, name);
    if (value === undefined) continue;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    return JSON.stringify(value);
  }
  return null;
}

/** GetInt: int.TryParse, then decimal.TryParse truncated toward zero. */
export function getHadithInt(element: unknown, ...names: string[]): number | null {
  const text = getHadithString(element, ...names);
  if (text === null) return null;
  const trimmed = text.trim();
  if (/^[+-]?\d+$/.test(trimmed)) {
    const integer = Number(trimmed);
    return integer >= INT32_MIN && integer <= INT32_MAX ? integer : null;
  }
  const numeric = trimmed.replace(/,/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(numeric)) return null;
  const truncated = Math.trunc(Number(numeric));
  return truncated >= INT32_MIN && truncated <= INT32_MAX ? truncated : null;
}

function parseHadith(item: unknown, fallbackBookSlug: string): HadithProviderRecord {
  let chapterNumber = getHadithInt(item, 'chapterNumber', 'chapter_number');
  const chapter = findHadithProperty(item, 'chapter');
  if (chapterNumber === null && asObject(chapter) !== null) chapterNumber = getHadithInt(chapter, 'chapterNumber', 'chapter_number', 'id');
  chapterNumber ??= getHadithInt(item, 'chapterId', 'chapter_id');

  return {
    id: getHadithInt(item, 'id') ?? 0,
    hadithNumber: getHadithString(item, 'hadithNumber', 'hadith_number') ?? '',
    bookSlug: getHadithString(item, 'bookSlug', 'book_slug') ?? fallbackBookSlug,
    chapterNumber,
    volume: getHadithInt(item, 'volume'),
    status: getHadithString(item, 'status'),
    englishNarrator: getHadithString(item, 'englishNarrator', 'english_narrator'),
    urduNarrator: getHadithString(item, 'urduNarrator', 'urdu_narrator'),
    english: getHadithString(item, 'hadithEnglish', 'hadith_english'),
    urdu: getHadithString(item, 'hadithUrdu', 'hadith_urdu'),
    arabic: getHadithString(item, 'hadithArabic', 'hadith_arabic'),
    headingEnglish: getHadithString(item, 'headingEnglish', 'heading_english'),
    headingUrdu: getHadithString(item, 'headingUrdu', 'heading_urdu'),
    headingArabic: getHadithString(item, 'headingArabic', 'heading_arabic'),
  };
}

function ensureSlug(slug: string): void {
  if (slug.trim().length === 0 || slug.length > 80 || !SLUG_PATTERN.test(slug)) throw new ArgumentError('Invalid Hadith book slug.', 'slug');
}

/** Retry-After as delta-seconds or an HTTP-date, in milliseconds; null when absent or unparseable. */
function parseRetryAfter(header: string | null, now: Date): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date - now.getTime() : null;
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/**
 * Typed client for https://hadithapi.com/api/ (3 minute timeout, UA DeenTime/1.0).
 * The API key travels as the `apiKey` query parameter, so request URLs are never
 * logged. Requests are serialized with 850 ms spacing, honour 429 Retry-After and
 * retry transport failures, exactly like HadithProviderClient.cs.
 */
@Injectable()
export class HadithProviderClient {
  static readonly providerName = 'hadithapi';
  static readonly languages: readonly string[] = ['ar', 'en', 'ur'];
  private static readonly timeoutMs = 3 * 60_000;
  private static readonly maxAttempts = 8;
  private static readonly spacingMs = 850;

  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly delay: (ms: number, signal?: AbortSignal) => Promise<void>;
  private gate: Promise<void> = Promise.resolve();
  private nextRequestAtMs = 0;

  constructor(
    private readonly options: IslamicContentOptions,
    @Optional() @Inject(PROVIDER_CLIENT_OPTIONS) clientOptions?: ProviderClientOptions,
  ) {
    this.fetch = resolveFetch(clientOptions);
    this.baseUrl = ensureTrailingSlash(clientOptions?.baseUrl ?? options.hadithBaseUrl);
    this.now = resolveClock(clientOptions);
    this.delay = clientOptions?.delay ?? realDelay;
  }

  get isConfigured(): boolean {
    return this.options.isHadithConfigured;
  }

  async getBooks(signal?: AbortSignal): Promise<HadithProviderBook[]> {
    const document = await this.getDocument('books', null, signal);
    return findHadithArray(document, 'books')
      .map(
        (item): HadithProviderBook => ({
          id: getHadithInt(item, 'id') ?? 0,
          slug: getHadithString(item, 'bookSlug', 'book_slug', 'slug') ?? '',
          name: getHadithString(item, 'bookName', 'book_name', 'name') ?? '',
          writerName: getHadithString(item, 'writerName', 'writer_name') ?? '',
          aboutWriter: getHadithString(item, 'aboutWriter', 'about_writer'),
          writerDeath: getHadithString(item, 'writerDeath', 'writer_death'),
          hadithCount: getHadithInt(item, 'hadiths_count', 'hadithCount', 'hadith_count') ?? 0,
          chapterCount: getHadithInt(item, 'chapters_count', 'chapterCount', 'chapter_count') ?? 0,
        }),
      )
      .filter((book) => book.id > 0 && book.slug.trim().length > 0);
  }

  async getChapters(bookSlug: string, signal?: AbortSignal): Promise<HadithProviderChapter[]> {
    ensureSlug(bookSlug);
    const document = await this.getDocument(`${bookSlug}/chapters`, null, signal);
    return findHadithArray(document, 'chapters')
      .map(
        (item): HadithProviderChapter => ({
          id: getHadithInt(item, 'id') ?? 0,
          bookSlug: getHadithString(item, 'bookSlug', 'book_slug') ?? bookSlug,
          chapterNumber: getHadithInt(item, 'chapterNumber', 'chapter_number') ?? 0,
          arabic: getHadithString(item, 'chapterArabic', 'chapter_arabic'),
          english: getHadithString(item, 'chapterEnglish', 'chapter_english'),
          urdu: getHadithString(item, 'chapterUrdu', 'chapter_urdu'),
        }),
      )
      .filter((chapter) => chapter.chapterNumber > 0);
  }

  async getHadithPage(bookSlug: string, page: number, pageSize = 200, signal?: AbortSignal): Promise<HadithProviderPage> {
    ensureSlug(bookSlug);
    if (page < 1) throw ArgumentError.outOfRange('page');
    const size = Math.min(200, Math.max(1, pageSize));

    const document = await this.getDocument('hadiths', { book: bookSlug, paginate: String(size), page: String(page) }, signal);
    const envelope = findHadithProperty(document, 'hadiths');
    if (asObject(envelope) === null) throw new IslamicContentProviderError('The Hadith provider returned an unexpected response.');

    const records = findHadithArray(envelope, 'data')
      .map((item) => parseHadith(item, bookSlug))
      .filter((record) => record.id > 0 && record.hadithNumber.trim().length > 0);

    return {
      currentPage: getHadithInt(envelope, 'current_page', 'currentPage') ?? page,
      lastPage: Math.max(1, getHadithInt(envelope, 'last_page', 'lastPage') ?? page),
      perPage: getHadithInt(envelope, 'per_page', 'perPage') ?? size,
      total: getHadithInt(envelope, 'total') ?? records.length,
      records,
    };
  }

  private async getDocument(relativePath: string, parameters: Record<string, string> | null, signal?: AbortSignal): Promise<unknown> {
    if (!this.isConfigured) throw new IslamicContentProviderError('The Hadith provider key has not been configured on the server.');

    const query: Array<[string, string]> = Object.entries(parameters ?? {});
    query.push(['apiKey', this.options.hadithApiKey]);
    // Carries the server-side secret: never log or surface this URL.
    const url = this.baseUrl + relativePath.replace(/^\/+/, '') + '?' + query.map(([key, value]) => `${escapeDataString(key)}=${escapeDataString(value)}`).join('&');

    for (let attempt = 1; attempt <= HadithProviderClient.maxAttempts; attempt++) {
      const outcome = await this.withGate(() => this.attempt(url, attempt, signal));
      if (outcome !== RETRY) return outcome.document;
    }
    throw new IslamicContentProviderError('The Hadith provider is currently unavailable.');
  }

  /** SemaphoreSlim(1, 1): one upstream request at a time across all callers. */
  private async withGate<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.gate;
    let release: () => void = () => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async attempt(url: string, attempt: number, signal?: AbortSignal): Promise<AttemptOutcome> {
    const throttleMs = this.nextRequestAtMs - this.now().getTime();
    if (throttleMs > 0) await this.delay(throttleMs, signal);

    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: { 'User-Agent': 'DeenTime/1.0' },
        signal: requestSignal(HadithProviderClient.timeoutMs, signal),
      });
    } catch (error) {
      return this.transportFailure(error, attempt);
    }
    this.nextRequestAtMs = this.now().getTime() + HadithProviderClient.spacingMs;

    if (response.status === 429) {
      discardBody(response);
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.now()) ?? Math.min(60, 3 * 2 ** (attempt - 1)) * 1000;
      this.nextRequestAtMs = this.now().getTime() + Math.min(120_000, Math.max(2_000, retryAfterMs));
      if (attempt === HadithProviderClient.maxAttempts) {
        throw new IslamicContentProviderError('The Hadith provider rate limit remained active after automatic retries.');
      }
      return RETRY;
    }

    if (!response.ok) {
      discardBody(response);
      throw new IslamicContentProviderError(`The Hadith provider returned HTTP ${response.status} (${httpStatusName(response.status)}).`);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      return this.transportFailure(error, attempt);
    }
    try {
      return { document: JSON.parse(text) as unknown };
    } catch (error) {
      throw new IslamicContentProviderError('The Hadith provider returned an invalid response.', { cause: error });
    }
  }

  private transportFailure(error: unknown, attempt: number): AttemptOutcome {
    const failure = classifyFetchError(error);
    if (failure === 'timeout') throw new IslamicContentProviderError('The Hadith provider timed out.', { cause: error });
    if (failure !== 'network') throw error;
    if (attempt === HadithProviderClient.maxAttempts) {
      throw new IslamicContentProviderError('The Hadith provider is currently unavailable.', { cause: error });
    }
    this.nextRequestAtMs = this.now().getTime() + Math.min(30, attempt * 2) * 1000;
    return RETRY;
  }
}
