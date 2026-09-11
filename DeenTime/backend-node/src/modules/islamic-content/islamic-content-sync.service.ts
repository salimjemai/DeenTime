import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ArgumentError, IslamicContentProviderError } from '../../integrations/islamic-content/errors.js';
import {
  HadithProviderClient,
  type HadithProviderBook,
  type HadithProviderChapter,
  type HadithProviderRecord,
} from '../../integrations/islamic-content/hadith-provider.client.js';
import { delay, formatCount } from '../../integrations/islamic-content/provider-http.js';
import { QuranProviderClient, type QuranProviderPayload } from '../../integrations/islamic-content/quran-provider.client.js';
import type { IslamicContentSyncRequest } from './sync-queue.js';
import { AsyncLock, chunk, distinctIgnoreCase, firstByKey, forEachParallel, range } from './sync-utils.js';

export const QURAN_SYNC_SCOPES: readonly string[] = ['catalog', 'text', 'all'];

interface StateChange {
  processed?: number;
  total?: number;
  message?: string | null;
  started?: boolean;
  completed?: boolean;
}

interface ParsedEdition {
  identifier: string;
  language: string;
  name: string;
  englishName: string;
  format: string;
  type: string;
  direction: string | null;
  syncedAtUtc: Date;
}

const INSERT_CHUNK_SIZE = 500;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 10 * 60_000 };

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
  return 'Synchronization failed. See server logs for technical details.';
}

/**
 * IslamicContentSyncService: downloads the Qur'an catalogue/corpus into the payload
 * cache and imports the Hadith library, reporting progress through
 * IslamicContentSyncState rows keyed by provider.
 */
@Injectable()
export class IslamicContentSyncService {
  constructor(
    private readonly quranClient: QuranProviderClient,
    private readonly hadithClient: HadithProviderClient,
    private readonly prisma: PrismaService,
  ) {}

  /** Runs one queued request; failures are recorded on the provider's sync state and rethrown. */
  async run(request: IslamicContentSyncRequest, signal?: AbortSignal): Promise<void> {
    try {
      switch (request.provider) {
        case 'quran':
          await this.syncQuran(request.scope, signal);
          break;
        case 'hadith':
          await this.syncHadith(signal);
          break;
        default:
          throw new ArgumentError(`Unknown Islamic content provider '${request.provider}'.`);
      }
    } catch (error) {
      await this.setState(request.provider, request.scope, 'failed', { message: safeSyncMessage(error), completed: true });
      throw error;
    }
  }

  private async syncQuran(scope: string, signal?: AbortSignal): Promise<void> {
    if (!QURAN_SYNC_SCOPES.includes(scope)) throw new ArgumentError("Qur'an sync scope must be catalog, text, or all.");

    await this.setState('quran', scope, 'running', { processed: 0, total: 1, message: 'Downloading edition catalogue…', started: true });

    const catalogue = await this.fetchRequiredQuran('edition', signal);
    const editions = parseQuranEditions(catalogue.json, new Date());
    await this.replaceQuranEditions(editions);

    const cataloguePaths = ['meta', 'surah', 'edition/type', 'edition/format', 'edition/language'];
    for (const type of new Set(editions.map((edition) => edition.type).filter((value) => value.length > 0))) cataloguePaths.push(`edition/type/${type}`);
    for (const format of new Set(editions.map((edition) => edition.format).filter((value) => value.length > 0))) cataloguePaths.push(`edition/format/${format}`);
    for (const language of new Set(editions.map((edition) => edition.language).filter((value) => value.length > 0))) {
      cataloguePaths.push(`edition/language/${language}`);
    }

    const corpusEditions = scope === 'catalog' ? [] : scope === 'text' ? editions.filter((edition) => edition.format.toLowerCase() === 'text') : editions;
    const corpusPaths = corpusEditions.map((edition) => `quran/${edition.identifier}`);
    const paths = distinctIgnoreCase([...cataloguePaths, ...corpusPaths]);
    const total = paths.length + 1;
    let processed = 1;
    await this.setState('quran', scope, 'running', {
      processed,
      total,
      message: scope === 'catalog' ? "Caching Qur'an metadata…" : `Caching ${corpusEditions.length} complete edition payloads…`,
    });

    const progressLock = new AsyncLock();
    await forEachParallel(
      paths,
      4,
      async (path) => {
        await this.fetchRequiredQuran(path, signal);
        const current = ++processed;
        if (current % 5 !== 0 && current !== total) return;
        await progressLock.run(() =>
          this.setState('quran', scope, 'running', { processed: current, total, message: `Cached ${formatCount(current)} of ${formatCount(total)} payloads` }),
        );
      },
      signal,
    );

    const message =
      scope === 'catalog'
        ? `${formatCount(editions.length)} editions and all catalogue metadata are ready.`
        : scope === 'text'
          ? `${formatCount(corpusEditions.length)} complete text editions are ready.`
          : `All ${formatCount(corpusEditions.length)} text and audio edition payloads are ready.`;
    await this.setState('quran', scope, 'complete', { processed: total, total, message, completed: true });
  }

  private async syncHadith(signal?: AbortSignal): Promise<void> {
    if (!this.hadithClient.isConfigured) throw new IslamicContentProviderError('The Hadith provider key has not been configured on the server.');

    const resumeAfter = await this.getFailedRunStart('hadith');
    await this.setState('hadith', 'all', 'running', { processed: 0, total: 1, message: 'Downloading Hadith book catalogue…', started: true });

    const books = await this.hadithClient.getBooks(signal);
    const expectedTotal = Math.max(
      1,
      books.reduce((sum, book) => sum + book.hadithCount + book.chapterCount, 0),
    );
    let processed = 0;
    await this.setState('hadith', 'all', 'running', {
      processed: 0,
      total: expectedTotal,
      message: `Importing ${formatCount(books.length)} books in Arabic, English, and Urdu…`,
    });

    for (const book of books) {
      signal?.throwIfAborted();
      if (resumeAfter !== null && (await this.wasImportedDuringRun(book, resumeAfter))) {
        processed += book.chapterCount + book.hadithCount;
        await this.setState('hadith', 'all', 'running', {
          processed: Math.min(processed, expectedTotal),
          total: expectedTotal,
          message: `Reused completed import: ${book.name}`,
        });
        continue;
      }

      const chapters = await this.hadithClient.getChapters(book.slug, signal);
      const records = book.hadithCount === 0 ? [] : await this.downloadHadithBook(book, processed, expectedTotal, signal);
      await this.replaceHadithBook(book, chapters, records);

      processed += chapters.length + records.length;
      await this.setState('hadith', 'all', 'running', {
        processed: Math.min(processed, expectedTotal),
        total: expectedTotal,
        message: `Imported ${book.name}: ${formatCount(records.length)} hadith`,
      });
    }

    await this.removeMissingHadithBooks(books.map((book) => book.slug));
    const actualTotal = books.reduce((sum, book) => sum + book.hadithCount + book.chapterCount, 0);
    await this.setState('hadith', 'all', 'complete', {
      processed: actualTotal,
      total: actualTotal,
      message: `${formatCount(books.length)} books are ready with Arabic, English, and Urdu content.`,
      completed: true,
    });
  }

  private async downloadHadithBook(book: HadithProviderBook, previouslyProcessed: number, expectedTotal: number, signal?: AbortSignal): Promise<HadithProviderRecord[]> {
    const firstPage = await this.hadithClient.getHadithPage(book.slug, 1, 200, signal);
    if (firstPage.lastPage <= 1) return firstPage.records;

    const pages = new Map<number, HadithProviderRecord[]>([[1, firstPage.records]]);
    let downloaded = firstPage.records.length;
    const progressLock = new AsyncLock();

    await forEachParallel(
      range(2, firstPage.lastPage - 1),
      2,
      async (pageNumber) => {
        const page = await this.hadithClient.getHadithPage(book.slug, pageNumber, 200, signal);
        pages.set(pageNumber, page.records);
        downloaded += page.records.length;
        const current = downloaded;
        if (current % 1000 >= page.records.length && pageNumber !== firstPage.lastPage) return;

        await progressLock.run(() =>
          this.setState('hadith', 'all', 'running', {
            processed: Math.min(previouslyProcessed + current, expectedTotal),
            total: expectedTotal,
            message: `Downloading ${book.name}: ${formatCount(current)} of ${formatCount(firstPage.total)}`,
          }),
        );
      },
      signal,
    );

    return [...pages.entries()].sort((left, right) => left[0] - right[0]).flatMap(([, records]) => records);
  }

  private async replaceQuranEditions(editions: ParsedEdition[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.quranEdition.findMany({ select: { identifier: true } });
      const incoming = new Set(editions.map((edition) => edition.identifier.toLowerCase()));
      const stale = existing.map((edition) => edition.identifier).filter((identifier) => !incoming.has(identifier.toLowerCase()));

      for (const edition of editions) {
        const { identifier, ...fields } = edition;
        await tx.quranEdition.upsert({ where: { identifier }, create: edition, update: fields });
      }
      if (stale.length > 0) await tx.quranEdition.deleteMany({ where: { identifier: { in: stale } } });
    }, TRANSACTION_OPTIONS);
  }

  private async replaceHadithBook(book: HadithProviderBook, chapters: HadithProviderChapter[], records: HadithProviderRecord[]): Promise<void> {
    const distinctChapters = firstByKey(chapters, (chapter) => String(chapter.chapterNumber));
    const distinctRecords = firstByKey(records, (record) => record.hadithNumber.toLowerCase());
    const syncedAt = new Date();

    const chapterRows: Prisma.HadithChapterCreateManyInput[] = distinctChapters.map((chapter) => ({
      id: randomUUID(),
      providerId: chapter.id,
      bookSlug: book.slug,
      chapterNumber: chapter.chapterNumber,
      chapterArabic: chapter.arabic,
      chapterEnglish: chapter.english,
      chapterUrdu: chapter.urdu,
      syncedAtUtc: syncedAt,
    }));
    const recordRows: Prisma.HadithRecordCreateManyInput[] = distinctRecords.map((record) => ({
      id: randomUUID(),
      providerId: record.id,
      hadithNumber: record.hadithNumber,
      bookSlug: book.slug,
      chapterNumber: record.chapterNumber,
      volume: record.volume,
      status: record.status,
      englishNarrator: record.englishNarrator,
      urduNarrator: record.urduNarrator,
      hadithEnglish: record.english,
      hadithUrdu: record.urdu,
      hadithArabic: record.arabic,
      headingEnglish: record.headingEnglish,
      headingUrdu: record.headingUrdu,
      headingArabic: record.headingArabic,
      syncedAtUtc: syncedAt,
    }));
    const bookFields = {
      bookSlug: book.slug,
      bookName: book.name,
      writerName: book.writerName,
      aboutWriter: book.aboutWriter,
      writerDeath: book.writerDeath,
      hadithCount: distinctRecords.length,
      chapterCount: distinctChapters.length,
      syncedAtUtc: syncedAt,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.hadithRecord.deleteMany({ where: { bookSlug: book.slug } });
      await tx.hadithChapter.deleteMany({ where: { bookSlug: book.slug } });
      await tx.hadithBook.upsert({ where: { providerId: book.id }, create: { providerId: book.id, ...bookFields }, update: bookFields });
      for (const rows of chunk(chapterRows, INSERT_CHUNK_SIZE)) await tx.hadithChapter.createMany({ data: rows });
      for (const rows of chunk(recordRows, INSERT_CHUNK_SIZE)) await tx.hadithRecord.createMany({ data: rows });
    }, TRANSACTION_OPTIONS);
  }

  private async removeMissingHadithBooks(currentSlugs: string[]): Promise<void> {
    const missing = (
      await this.prisma.hadithBook.findMany({
        where: currentSlugs.length > 0 ? { bookSlug: { notIn: currentSlugs } } : {},
        select: { bookSlug: true },
      })
    ).map((book) => book.bookSlug);
    if (missing.length === 0) return;

    await this.prisma.hadithRecord.deleteMany({ where: { bookSlug: { in: missing } } });
    await this.prisma.hadithChapter.deleteMany({ where: { bookSlug: { in: missing } } });
    await this.prisma.hadithBook.deleteMany({ where: { bookSlug: { in: missing } } });
  }

  private async getFailedRunStart(provider: string): Promise<Date | null> {
    const state = await this.prisma.islamicContentSyncState.findFirst({
      where: { key: provider, status: 'failed' },
      select: { startedAtUtc: true },
    });
    return state?.startedAtUtc ?? null;
  }

  private async wasImportedDuringRun(book: HadithProviderBook, runStartedAtUtc: Date): Promise<boolean> {
    const count = await this.prisma.hadithBook.count({
      where: { bookSlug: book.slug, hadithCount: book.hadithCount, syncedAtUtc: { gte: runStartedAtUtc } },
    });
    return count > 0;
  }

  private async fetchRequiredQuran(path: string, signal?: AbortSignal): Promise<QuranProviderPayload> {
    // .NET retried three times with 350 ms × attempt. The Node fetch is quicker and the
    // catalogue sync runs four downloads in parallel, which trips AlQuran Cloud's rate
    // limit (HTTP 429) more easily, so 429s get a longer back-off and two extra attempts.
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await this.quranClient.get(path, undefined, true, signal);
      if (response.statusCode >= 200 && response.statusCode < 300) return response;
      lastStatus = response.statusCode;
      if (lastStatus !== 429 && attempt >= 3) break;
      if (attempt < 5) await delay(lastStatus === 429 ? 2_000 * attempt : 350 * attempt, signal);
    }
    throw new IslamicContentProviderError(`The Qur'an provider could not supply the documented endpoint '/${path}' (HTTP ${lastStatus}).`);
  }

  /** Upserts the provider's IslamicContentSyncState row (key = lower-cased provider). */
  private async setState(provider: string, scope: string, status: string, change: StateChange = {}): Promise<void> {
    const key = provider.toLowerCase();
    const now = new Date();
    const timestamps = {
      ...(change.started ? { startedAtUtc: now, completedAtUtc: null } : {}),
      ...(change.completed ? { completedAtUtc: now } : {}),
    };
    await this.prisma.islamicContentSyncState.upsert({
      where: { key },
      create: {
        key,
        provider,
        scope,
        status,
        processedItems: change.processed ?? 0,
        totalItems: change.total ?? 0,
        message: change.message ?? null,
        startedAtUtc: null,
        completedAtUtc: null,
        updatedAtUtc: now,
        ...timestamps,
      },
      update: {
        scope,
        status,
        ...(change.processed !== undefined ? { processedItems: change.processed } : {}),
        ...(change.total !== undefined ? { totalItems: change.total } : {}),
        message: change.message ?? null,
        updatedAtUtc: now,
        ...timestamps,
      },
    });
  }
}
