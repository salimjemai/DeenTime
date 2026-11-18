import type { SqlParam } from '../../core/db.js';
import { HadithProviderClient } from '../../integrations/islamic-content/hadith-provider.client.js';

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
  syncedAtUtc: string;
}

export interface HadithRecordRow {
  ProviderId: number;
  HadithNumber: string;
  BookSlug: string;
  ChapterNumber: number | null;
  Volume: number | null;
  Status: string | null;
  EnglishNarrator: string | null;
  UrduNarrator: string | null;
  HadithEnglish: string | null;
  HadithUrdu: string | null;
  HadithArabic: string | null;
  HeadingEnglish: string | null;
  HeadingUrdu: string | null;
  HeadingArabic: string | null;
  SyncedAtUtc: string;
}

export const HADITH_RECORD_COLUMNS =
  '"ProviderId", "HadithNumber", "BookSlug", "ChapterNumber", "Volume", "Status", "EnglishNarrator", "UrduNarrator", "HadithEnglish", "HadithUrdu", "HadithArabic", "HeadingEnglish", "HeadingUrdu", "HeadingArabic", "SyncedAtUtc"';

export function toPublicHadith(record: HadithRecordRow): PublicHadithRecord {
  return {
    id: record.ProviderId,
    hadithNumber: record.HadithNumber,
    bookSlug: record.BookSlug,
    chapterNumber: record.ChapterNumber,
    volume: record.Volume,
    status: record.Status,
    englishNarrator: record.EnglishNarrator,
    urduNarrator: record.UrduNarrator,
    hadithEnglish: record.HadithEnglish,
    hadithUrdu: record.HadithUrdu,
    hadithArabic: record.HadithArabic,
    headingEnglish: record.HeadingEnglish,
    headingUrdu: record.HeadingUrdu,
    headingArabic: record.HeadingArabic,
    syncedAtUtc: record.SyncedAtUtc,
  };
}

export function isSupportedLanguage(language: string | undefined): boolean {
  return language === undefined || language.trim().length === 0 || HadithProviderClient.languages.some((item) => item === language.toLowerCase());
}

type TextColumn = 'HadithArabic' | 'HadithEnglish' | 'HadithUrdu' | 'EnglishNarrator';

/** Predicate for `!string.IsNullOrEmpty(column)`. */
function nonEmpty(column: TextColumn): string {
  return `("${column}" IS NOT NULL AND "${column}" <> '')`;
}

export interface SqlFilter {
  /** '' or ' WHERE ...'. */
  where: string;
  params: SqlParam[];
}

/**
 * FilterHadiths: book/chapter/status equality, language presence and a contains search.
 * The search was PostgreSQL ILIKE; SQLite LIKE ignores case for ASCII letters only, which
 * is the same for Arabic and Urdu text (no letter case) and for English.
 */
export function filterHadiths(book: string | undefined, chapter: number | undefined, status: string | undefined, search: string | undefined, language: string | undefined): SqlFilter {
  const conditions: string[] = [];
  const params: SqlParam[] = [];
  if (book?.trim()) {
    conditions.push('"BookSlug" = ?');
    params.push(book);
  }
  if (chapter !== undefined) {
    conditions.push('"ChapterNumber" = ?');
    params.push(chapter);
  }
  if (status?.trim()) {
    conditions.push('"Status" = ?');
    params.push(status);
  }

  const lang = language?.toLowerCase();
  const languageColumn: TextColumn | null = lang === 'ar' ? 'HadithArabic' : lang === 'ur' ? 'HadithUrdu' : lang === 'en' ? 'HadithEnglish' : null;
  if (languageColumn !== null) conditions.push(nonEmpty(languageColumn));

  if (search?.trim()) {
    const pattern = `%${search.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const columns: TextColumn[] = languageColumn !== null ? [languageColumn] : ['HadithArabic', 'HadithEnglish', 'HadithUrdu', 'EnglishNarrator'];
    conditions.push(`(${columns.map((column) => `"${column}" LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    for (const _ of columns) params.push(pattern);
  }
  return { where: conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`, params };
}
