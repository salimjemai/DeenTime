/**
 * The content synchronization of backend-node's IslamicContentSyncService, reshaped for
 * D1: a Worker on the free plan cannot run it (10 ms CPU, 50 subrequests, no background
 * process), so it runs on a PC through scripts/sync-content.mjs. This module downloads
 * from the providers with the same clients, options and mapping, and hands the rows to a
 * sink as SQL text; the script writes them to .sql files for `wrangler d1 execute`.
 *
 * Pure code: no Node or Worker APIs beyond fetch, timers and crypto.randomUUID, so the
 * script bundles it with esbuild and the tests run it in workerd with a fake fetch.
 *
 * Differences from backend-node, all forced by D1 limits (2 MB per row, 100 KB per statement):
 *  - Complete editions (/quran/{edition}) are not stored whole. Each is split into one
 *    /ayah/{number}/{edition} cache row per ayah, which is what the showcase routes read.
 *  - Only the selected editions are split (default: the three showcase editions); the
 *    whole catalogue would be about 140 editions x 6,236 rows.
 *  - A failed Hadith import is not resumed automatically; rerun with `books` to continue.
 */
import { ArgumentError, IslamicContentProviderError } from '../../integrations/islamic-content/errors.js';
import {
  HadithProviderClient,
  type HadithProviderBook,
  type HadithProviderChapter,
  type HadithProviderRecord,
} from '../../integrations/islamic-content/hadith-provider.client.js';
import type { IslamicContentOptions } from '../../integrations/islamic-content/islamic-content-options.js';
import {
  classifyFetchError,
  delay as realDelay,
  ensureTrailingSlash,
  formatCount,
  requestSignal,
  resolveClock,
  resolveFetch,
  type ProviderClientOptions,
} from '../../integrations/islamic-content/provider-http.js';
import {
  MAX_CACHEABLE_PAYLOAD_BYTES,
  QuranProviderClient,
  canonicalizeQuranRequest,
  utf8ByteLength,
} from '../../integrations/islamic-content/quran-provider.client.js';
import { SHOWCASE_EDITIONS, ayahCacheKey, splitEditionIntoAyahs } from '../public-content/quran-showcase.js';
import { rowStatements, sqlLiteral, type SqlValue } from './sql-text.js';
import { QURAN_SYNC_SCOPES } from './sync-state.js';
import { distinctIgnoreCase, firstByKey, forEachParallel, range } from './sync-utils.js';

export { QURAN_SYNC_SCOPES };

/** Receives groups of SQL statements in the order they must be applied. */
export interface SqlSink {
  write(label: string, statements: string[]): Promise<void>;
}

export interface OfflineSyncDeps {
  options: IslamicContentOptions;
  sink: SqlSink;
  /** fetch / clock / delay overrides (tests). */
  clientOptions?: ProviderClientOptions;
  log?: (message: string) => void;
}

export interface QuranSyncRequest {
  /** catalog: editions and metadata. text: plus the ayahs of the selected text editions. all: text and audio. */
  scope: string;
  /** Edition identifiers to split into ayah rows, or 'all' for the whole catalogue. Default: the showcase editions. */
  editions?: readonly string[] | 'all';
}

export interface QuranSyncResult {
  editions: number;
  cataloguePayloads: number;
  ayahEditions: string[];
  ayahRows: number;
}

export interface HadithSyncRequest {
  /** Book slugs to import. Default: every book; books the provider no longer lists are then removed. */
  books?: readonly string[];
}

export interface HadithSyncResult {
  books: number;
  chapters: number;
  records: number;
}

export interface ParsedEdition {
  identifier: string;
  language: string;
  name: string;
  englishName: string;
  format: string;
  type: string;
  direction: string | null;
  syncedAtUtc: Date;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function jsonString(element: unknown, propertyName: string): string | null {
  const value = asObject(element)?.[propertyName];
  return typeof value === 'string' ? value : null;
}

/** ParseEditions: the /edition catalogue → QuranEdition rows (items without an identifier are dropped). */
export function parseQuranEditions(json: string, syncedAtUtc: Date): ParsedEdition[] {
  const document = JSON.parse(json) as unknown;
  const data = asObject(document)?.data;
  if (!Array.isArray(data)) throw new IslamicContentProviderError("The Qur'an edition catalogue had an unexpected shape.");
  return data
    .map(
      (item): ParsedEdition => ({
        identifier: jsonString(item, 'identifier') ?? '',
        language: jsonString(item, 'language') ?? '',
        name: jsonString(item, 'name') ?? '',
        englishName: jsonString(item, 'englishName') ?? '',
        format: jsonString(item, 'format') ?? '',
        type: jsonString(item, 'type') ?? '',
        direction: jsonString(item, 'direction'),
        syncedAtUtc,
      }),
    )
    .filter((edition) => edition.identifier.length > 0);
}

/** SafeMessage: only argument/provider errors are safe to show to administrators. */
export function safeSyncMessage(error: unknown): string {
  if (error instanceof ArgumentError || error instanceof IslamicContentProviderError) return error.message;
  return 'Synchronization failed. See the sync script output for technical details.';
}

export interface StateChange {
  processed?: number;
  total?: number;
  message?: string | null;
  started?: boolean;
  completed?: boolean;
}

/** setState: upserts the provider's IslamicContentSyncStates row (key = lower-cased provider). */
export function syncStateStatement(provider: string, scope: string, status: string, change: StateChange, now: Date): string {
  const stamp = now.toISOString();
  const row: Record<string, SqlValue> = {
    Key: provider.toLowerCase(),
    Provider: provider,
    Scope: scope,
    Status: status,
    ProcessedItems: change.processed ?? 0,
    TotalItems: change.total ?? 0,
    Message: change.message ?? null,
    StartedAtUtc: change.started ? stamp : null,
    CompletedAtUtc: change.completed ? stamp : null,
    UpdatedAtUtc: stamp,
  };
  const columns = Object.keys(row);
  const updates = ['"Scope" = excluded."Scope"', '"Status" = excluded."Status"', '"Message" = excluded."Message"', '"UpdatedAtUtc" = excluded."UpdatedAtUtc"'];
  if (change.processed !== undefined) updates.push('"ProcessedItems" = excluded."ProcessedItems"');
  if (change.total !== undefined) updates.push('"TotalItems" = excluded."TotalItems"');
  if (change.started) updates.push('"StartedAtUtc" = excluded."StartedAtUtc"', '"CompletedAtUtc" = NULL');
  if (change.completed) updates.push('"CompletedAtUtc" = excluded."CompletedAtUtc"');
  return (
    `INSERT INTO "IslamicContentSyncStates" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map((column) => sqlLiteral(row[column] ?? null)).join(', ')})` +
    ` ON CONFLICT ("Key") DO UPDATE SET ${updates.join(', ')};`
  );
}

/** Upsert of one payload-cache row; [] when the payload does not fit in a D1 row. */
export function cacheEntryStatements(cacheKey: string, json: string, contentType: string, retrievedAt: Date, cacheDays: number): string[] {
  const payloadBytes = utf8ByteLength(json);
  if (payloadBytes > MAX_CACHEABLE_PAYLOAD_BYTES) return [];
  const days = Math.min(365, Math.max(1, cacheDays));
  return rowStatements(
    'IslamicContentCacheEntries',
    {
      Id: crypto.randomUUID(),
      Provider: QuranProviderClient.providerName,
      CacheKey: cacheKey,
      PayloadJson: json,
      ContentType: contentType.slice(0, 80),
      RetrievedAtUtc: retrievedAt.toISOString(),
      ExpiresAtUtc: new Date(retrievedAt.getTime() + days * 86_400_000).toISOString(),
      PayloadBytes: payloadBytes,
    },
    { key: ['Provider', 'CacheKey'], upsert: true, insertOnly: ['Id'] },
  );
}

/** replaceQuranEditions: upsert every edition, then drop the ones the catalogue no longer lists. */
export function quranEditionStatements(editions: readonly ParsedEdition[]): string[] {
  const statements = editions.flatMap((edition) =>
    rowStatements(
      'QuranEditions',
      {
        Identifier: edition.identifier,
        Language: edition.language,
        Name: edition.name,
        EnglishName: edition.englishName,
        Format: edition.format,
        Type: edition.type,
        Direction: edition.direction,
        SyncedAtUtc: edition.syncedAtUtc.toISOString(),
      },
      { key: ['Identifier'], upsert: true },
    ),
  );
  const stamp = editions[0]?.syncedAtUtc.toISOString();
  if (stamp !== undefined) statements.push(`DELETE FROM "QuranEditions" WHERE "SyncedAtUtc" <> ${sqlLiteral(stamp)};`);
  return statements;
}

/** replaceHadithBook: the book's chapters and records are deleted and written again. */
export function hadithBookStatements(book: HadithProviderBook, chapters: readonly HadithProviderChapter[], records: readonly HadithProviderRecord[], syncedAt: Date): string[] {
  const distinctChapters = firstByKey(chapters, (chapter) => String(chapter.chapterNumber));
  const distinctRecords = firstByKey(records, (record) => record.hadithNumber.toLowerCase());
  const stamp = syncedAt.toISOString();
  const slug = sqlLiteral(book.slug);

  const statements = [
    `DELETE FROM "HadithRecords" WHERE "BookSlug" = ${slug};`,
    `DELETE FROM "HadithChapters" WHERE "BookSlug" = ${slug};`,
    ...rowStatements(
      'HadithBooks',
      {
        ProviderId: book.id,
        BookSlug: book.slug,
        BookName: book.name,
        WriterName: book.writerName,
        AboutWriter: book.aboutWriter,
        WriterDeath: book.writerDeath,
        HadithCount: distinctRecords.length,
        ChapterCount: distinctChapters.length,
        SyncedAtUtc: stamp,
      },
      { key: ['ProviderId'], upsert: true },
    ),
  ];
  for (const chapter of distinctChapters) {
    statements.push(
      ...rowStatements(
        'HadithChapters',
        {
          Id: crypto.randomUUID(),
          ProviderId: chapter.id,
          BookSlug: book.slug,
          ChapterNumber: chapter.chapterNumber,
          ChapterEnglish: chapter.english,
          ChapterUrdu: chapter.urdu,
          ChapterArabic: chapter.arabic,
          SyncedAtUtc: stamp,
        },
        { key: ['Id'] },
      ),
    );
  }
  for (const record of distinctRecords) {
    statements.push(
      ...rowStatements(
        'HadithRecords',
        {
          Id: crypto.randomUUID(),
          ProviderId: record.id,
          HadithNumber: record.hadithNumber,
          BookSlug: book.slug,
          ChapterNumber: record.chapterNumber,
          Volume: record.volume,
          Status: record.status,
          EnglishNarrator: record.englishNarrator,
          UrduNarrator: record.urduNarrator,
          HadithEnglish: record.english,
          HadithUrdu: record.urdu,
          HadithArabic: record.arabic,
          HeadingEnglish: record.headingEnglish,
          HeadingUrdu: record.headingUrdu,
          HeadingArabic: record.headingArabic,
          SyncedAtUtc: stamp,
        },
        { key: ['Id'] },
      ),
    );
  }
  return statements;
}

/** removeMissingHadithBooks. */
export function removeMissingHadithBooksStatements(currentSlugs: readonly string[]): string[] {
  const where = currentSlugs.length > 0 ? ` WHERE "BookSlug" NOT IN (${currentSlugs.map(sqlLiteral).join(', ')})` : '';
  return ['HadithRecords', 'HadithChapters', 'HadithBooks'].map((table) => `DELETE FROM "${table}"${where};`);
}

interface QuranDocument {
  cacheKey: string;
  json: string;
  contentType: string;
}

/**
 * fetchRequiredQuran: the documented endpoint straight from the provider (never the cache),
 * with backend-node's retries: three attempts 350 ms x attempt apart, and for HTTP 429 up
 * to five attempts 2 s x attempt apart.
 */
async function fetchRequiredQuran(path: string, deps: OfflineSyncDeps): Promise<QuranDocument> {
  const request = canonicalizeQuranRequest(path);
  const fetcher = resolveFetch(deps.clientOptions);
  const wait = deps.clientOptions?.delay ?? realDelay;
  const baseUrl = ensureTrailingSlash(deps.clientOptions?.baseUrl ?? deps.options.quranBaseUrl);

  let lastStatus = 0;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let response: Response;
    let json: string;
    try {
      response = await fetcher(baseUrl + request.relativeUri, { headers: { 'User-Agent': 'DeenTime/1.0' }, signal: requestSignal(3 * 60_000) });
      json = await response.text();
    } catch (error) {
      if (classifyFetchError(error) === null) throw error;
      throw new IslamicContentProviderError("The Qur'an content provider is currently unavailable.", { cause: error });
    }
    if (response.ok) {
      try {
        JSON.parse(json);
      } catch (error) {
        throw new IslamicContentProviderError("The Qur'an provider returned an invalid response.", { cause: error });
      }
      return { cacheKey: request.cacheKey, json, contentType: response.headers.get('content-type') ?? 'application/json; charset=utf-8' };
    }
    lastStatus = response.status;
    if (lastStatus !== 429 && attempt >= 3) break;
    if (attempt < 5) await wait(lastStatus === 429 ? 2_000 * attempt : 350 * attempt);
  }
  throw new IslamicContentProviderError(`The Qur'an provider could not supply the documented endpoint '/${path}' (HTTP ${lastStatus}).`);
}

function selectAyahEditions(request: QuranSyncRequest, scope: string, editions: readonly ParsedEdition[]): ParsedEdition[] {
  if (scope === 'catalog') return [];
  const inScope = scope === 'text' ? editions.filter((edition) => edition.format.toLowerCase() === 'text') : [...editions];
  if (request.editions === 'all') return inScope;

  const wanted = distinctIgnoreCase((request.editions ?? SHOWCASE_EDITIONS).map((identifier) => identifier.trim()).filter((identifier) => identifier.length > 0));
  const byIdentifier = new Map(editions.map((edition) => [edition.identifier.toLowerCase(), edition]));
  const unknown = wanted.filter((identifier) => !byIdentifier.has(identifier.toLowerCase()));
  // The defaults are best effort; a requested edition that does not exist is a mistake.
  if (request.editions !== undefined && unknown.length > 0) throw new ArgumentError(`Unknown Qur'an edition: ${unknown.join(', ')}.`);
  return inScope.filter((edition) => wanted.some((identifier) => identifier.toLowerCase() === edition.identifier.toLowerCase()));
}

/**
 * syncQuran. Writes, in order: the running state; one group with the edition catalogue and
 * every catalogue metadata payload; one group per selected edition with its ayah rows; the
 * complete state. A failure records the failed state and is rethrown.
 */
export async function syncQuranOffline(request: QuranSyncRequest, deps: OfflineSyncDeps): Promise<QuranSyncResult> {
  const scope = request.scope.trim().toLowerCase();
  const now = resolveClock(deps.clientOptions);
  const log = deps.log ?? (() => undefined);
  const state = (status: string, change: StateChange): string => syncStateStatement('quran', scope, status, change, now());
  const cacheDays = deps.options.quranCacheDays;

  try {
    if (!QURAN_SYNC_SCOPES.includes(scope)) throw new ArgumentError("Qur'an sync scope must be catalog, text, or all.");
    await deps.sink.write('quran-state', [state('running', { processed: 0, total: 1, message: 'Downloading edition catalogue…', started: true })]);

    log('Downloading the edition catalogue');
    const catalogue = await fetchRequiredQuran('edition', deps);
    const editions = parseQuranEditions(catalogue.json, now());
    const ayahEditions = selectAyahEditions(request, scope, editions);

    const cataloguePaths = ['meta', 'surah', 'edition/type', 'edition/format', 'edition/language'];
    for (const type of new Set(editions.map((edition) => edition.type).filter((value) => value.length > 0))) cataloguePaths.push(`edition/type/${type}`);
    for (const format of new Set(editions.map((edition) => edition.format).filter((value) => value.length > 0))) cataloguePaths.push(`edition/format/${format}`);
    for (const language of new Set(editions.map((edition) => edition.language).filter((value) => value.length > 0))) {
      cataloguePaths.push(`edition/language/${language}`);
    }
    const paths = distinctIgnoreCase(cataloguePaths);
    const total = paths.length + 1 + ayahEditions.length;

    log(`Downloading ${paths.length} catalogue payloads`);
    const documents = new Map<string, QuranDocument>();
    await forEachParallel(paths, 4, async (path) => {
      documents.set(path, await fetchRequiredQuran(path, deps));
    });
    const retrievedAt = now();
    const catalogueStatements = [...quranEditionStatements(editions), ...cacheEntryStatements(catalogue.cacheKey, catalogue.json, catalogue.contentType, retrievedAt, cacheDays)];
    for (const path of paths) {
      const document = documents.get(path);
      if (document) catalogueStatements.push(...cacheEntryStatements(document.cacheKey, document.json, document.contentType, retrievedAt, cacheDays));
    }
    let processed = paths.length + 1;
    catalogueStatements.push(
      state('running', {
        processed,
        total,
        message: ayahEditions.length === 0 ? "Caching Qur'an metadata…" : `Caching the ayahs of ${formatCount(ayahEditions.length)} editions…`,
      }),
    );
    await deps.sink.write('quran-catalogue', catalogueStatements);

    let ayahRows = 0;
    for (const edition of ayahEditions) {
      log(`Downloading ${edition.identifier}`);
      const document = await fetchRequiredQuran(`quran/${edition.identifier}`, deps);
      const ayahs = splitEditionIntoAyahs(JSON.parse(document.json) as unknown);
      if (ayahs === null) throw new IslamicContentProviderError(`The Qur'an edition '${edition.identifier}' had an unexpected shape.`);
      const stamp = now();
      const statements = ayahs.flatMap((ayah) => cacheEntryStatements(ayahCacheKey(ayah.number, edition.identifier), ayah.json, document.contentType, stamp, cacheDays));
      ayahRows += ayahs.length;
      processed += 1;
      statements.push(state('running', { processed, total, message: `Cached ${formatCount(processed)} of ${formatCount(total)} payloads` }));
      await deps.sink.write(`quran-ayahs-${edition.identifier}`, statements);
    }

    const message =
      ayahEditions.length === 0
        ? `${formatCount(editions.length)} editions and all catalogue metadata are ready.`
        : `${formatCount(editions.length)} editions, the catalogue metadata and the ayahs of ${formatCount(ayahEditions.length)} editions (${ayahEditions.map((edition) => edition.identifier).join(', ')}) are ready.`;
    await deps.sink.write('quran-state', [state('complete', { processed: total, total, message: message.slice(0, 1000), completed: true })]);
    log(message);
    return { editions: editions.length, cataloguePayloads: paths.length + 1, ayahEditions: ayahEditions.map((edition) => edition.identifier), ayahRows };
  } catch (error) {
    await deps.sink.write('quran-state', [state('failed', { message: safeSyncMessage(error), completed: true })]).catch(() => undefined);
    throw error;
  }
}

async function downloadHadithBook(client: HadithProviderClient, book: HadithProviderBook, log: (message: string) => void): Promise<HadithProviderRecord[]> {
  const firstPage = await client.getHadithPage(book.slug, 1, 200);
  if (firstPage.lastPage <= 1) return firstPage.records;

  const pages = new Map<number, HadithProviderRecord[]>([[1, firstPage.records]]);
  let downloaded = firstPage.records.length;
  await forEachParallel(range(2, firstPage.lastPage - 1), 2, async (pageNumber) => {
    const page = await client.getHadithPage(book.slug, pageNumber, 200);
    pages.set(pageNumber, page.records);
    downloaded += page.records.length;
    if (downloaded % 1000 < page.records.length || pageNumber === firstPage.lastPage) log(`Downloading ${book.name}: ${formatCount(downloaded)} of ${formatCount(firstPage.total)}`);
  });
  return [...pages.entries()].sort((left, right) => left[0] - right[0]).flatMap(([, records]) => records);
}

/**
 * syncHadith. Writes the running state, then one group per book (its chapters and records
 * replace the stored ones, with the progress), then the removal of books the provider no
 * longer lists (full imports only) with the complete state.
 */
export async function syncHadithOffline(request: HadithSyncRequest, deps: OfflineSyncDeps): Promise<HadithSyncResult> {
  const now = resolveClock(deps.clientOptions);
  const log = deps.log ?? (() => undefined);
  const state = (status: string, change: StateChange): string => syncStateStatement('hadith', 'all', status, change, now());

  try {
    if (!deps.options.isHadithConfigured) throw new IslamicContentProviderError('The Hadith provider key has not been configured on the server.');
    const client = new HadithProviderClient(deps.options, deps.clientOptions);
    await deps.sink.write('hadith-state', [state('running', { processed: 0, total: 1, message: 'Downloading Hadith book catalogue…', started: true })]);

    const catalogue = await client.getBooks();
    const wanted = request.books?.map((slug) => slug.trim()).filter((slug) => slug.length > 0);
    const partial = wanted !== undefined && wanted.length > 0;
    const unknown = partial ? wanted.filter((slug) => !catalogue.some((book) => book.slug === slug)) : [];
    if (unknown.length > 0) throw new ArgumentError(`Unknown Hadith book: ${unknown.join(', ')}.`);
    const books = partial ? catalogue.filter((book) => wanted.includes(book.slug)) : catalogue;

    const expectedTotal = Math.max(
      1,
      books.reduce((sum, book) => sum + book.hadithCount + book.chapterCount, 0),
    );
    let processed = 0;
    let chapterTotal = 0;
    let recordTotal = 0;
    await deps.sink.write('hadith-state', [
      state('running', { processed: 0, total: expectedTotal, message: `Importing ${formatCount(books.length)} books in Arabic, English, and Urdu…` }),
    ]);

    for (const book of books) {
      log(`Downloading ${book.name}`);
      const chapters = await client.getChapters(book.slug);
      const records = book.hadithCount === 0 ? [] : await downloadHadithBook(client, book, log);
      const statements = hadithBookStatements(book, chapters, records, now());

      processed += chapters.length + records.length;
      chapterTotal += chapters.length;
      recordTotal += records.length;
      statements.push(
        state('running', { processed: Math.min(processed, expectedTotal), total: expectedTotal, message: `Imported ${book.name}: ${formatCount(records.length)} hadith` }),
      );
      await deps.sink.write(`hadith-${book.slug}`, statements);
    }

    const actualTotal = books.reduce((sum, book) => sum + book.hadithCount + book.chapterCount, 0);
    const message = partial
      ? `${formatCount(books.length)} of ${formatCount(catalogue.length)} books were imported with Arabic, English, and Urdu content.`
      : `${formatCount(books.length)} books are ready with Arabic, English, and Urdu content.`;
    await deps.sink.write('hadith-state', [
      ...(partial ? [] : removeMissingHadithBooksStatements(books.map((book) => book.slug))),
      state('complete', { processed: actualTotal, total: actualTotal, message, completed: true }),
    ]);
    log(message);
    return { books: books.length, chapters: chapterTotal, records: recordTotal };
  } catch (error) {
    await deps.sink.write('hadith-state', [state('failed', { message: safeSyncMessage(error), completed: true })]).catch(() => undefined);
    throw error;
  }
}

/** For scripts/sync-content.mjs, which bundles this module and builds the options from its settings. */
export { IslamicContentOptions } from '../../integrations/islamic-content/islamic-content-options.js';
