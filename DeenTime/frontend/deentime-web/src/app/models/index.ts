// ── Auth ─────────────────────────────────────────────────────────────────────
export interface LoginRequest  { email: string; password: string; }
export interface RegisterRequest { email: string; password: string; organizationName?: string; }
export interface AuthResponse  { token: string; }

// ── Organization ──────────────────────────────────────────────────────────────
export interface Organization {
  id: string;
  slug: string;
  name: string;
  addressLine?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  websiteUrl?: string;
  email?: string;
  socialUrl?: string;
  criteria?: PrayerTimingCriteria;
  updatedAtUtc: string;
}

export interface OrganizationUpdateRequest {
  name: string;
  addressLine?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  websiteUrl?: string;
  email?: string;
  socialUrl?: string;
}

// ── Prayer Timing Criteria ────────────────────────────────────────────────────
export interface PrayerTimingCriteria {
  id: string;
  organizationId: string;
  method: string;
  juristicMethodAsr: string;
  latitude: number;
  longitude: number;
  timezoneId: string;
  dstObserved: boolean;
  dstBegins?: string;
  dstEnds?: string;
  zipCode: string;
  minutesAfterZawal: number;
  minutesAfterMaghrib: number;
  khutbahTimeMinutes: number;
  updatedAtUtc: string;
}

// ── Prayer Times ──────────────────────────────────────────────────────────────
export interface PrayerTimesDto {
  date: string;       // YYYY-MM-DD
  fajr: string;       // HH:mm
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  sunset: string;
  isha: string;
}

// ── Iqama ─────────────────────────────────────────────────────────────────────
export type SalahType = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha' | 'Jumuah' | 'Jumuah2nd' | 'Jumuah3rd' | 'Jumuah4th' | 'Khutbah';

export interface IqamaEntry {
  id: string;
  organizationId: string;
  date: string;       // YYYY-MM-DD
  salah: SalahType;
  time: string;       // HH:mm
  note?: string;
  offsetMinutes?: number;
  updatedAtUtc: string;
}

export interface IqamaUpsertRequest {
  organizationId: string;
  date: string;
  salah: SalahType;
  time: string;
  note?: string;
  offsetMinutes?: number;
}

// ── Design Settings ───────────────────────────────────────────────────────────
export interface DesignSettings {
  id: string;
  organizationId: string;
  headerImageUrl?: string;
  iqamaHeadings: string[];
  footerHtml?: string;
  theme?: string;
  updatedAtUtc: string;
}

export interface DesignRequest {
  headerImageUrl?: string;
  iqamaHeadings: string[];
  footerHtml?: string;
  theme?: string;
}

// ── Hijri ─────────────────────────────────────────────────────────────────────
export interface HijriMonthMap {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  hijriDayOnFirst: number;
  hijriMonthOnFirst: number;
  hijriYearOnFirst: number;
  locked: boolean;
  updatedAtUtc: string;
}

// ── Publish ───────────────────────────────────────────────────────────────────
export type PdfSize        = 'Letter' | 'Tabloid';
export type PdfOrientation = 'Portrait' | 'Landscape';

export interface PublishArtifact {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  size: PdfSize;
  orientation: PdfOrientation;
  storageUrl: string;
  createdAtUtc: string;
}

export interface PdfGenerateRequest {
  orgId: string;
  year: number;
  month: number;
  size: PdfSize;
  orientation: PdfOrientation;
}

// ── TV Display ────────────────────────────────────────────────────────────────
export interface TvDisplayConfig {
  id: string;
  organizationId: string;
  showSeconds: boolean;
  showHijri: boolean;
  accentColor: string;
  autoRefreshSeconds: number;
}

export interface PublicDisplay {
  organization: {
    name: string;
    slug: string;
    addressLine?: string;
    city?: string;
    state?: string;
  };
  date: string;
  timezoneId: string;
  timings: PrayerTimesDto;
  iqama: { salah: string; time: string; salahTime?: string; note?: string; effectiveDate?: string }[];
  monthlyPdfUrl?: string;
  design?: {
    headerImageUrl?: string;
    backgroundImageUrl?: string;
    iqamaHeadings: string[];
    footerHtml?: string;
    theme?: string;
  };
  hijri?: { day: number; month: number; year: number; monthName: string; formatted: string };
  tvConfig?: {
    showSeconds: boolean;
    showHijri: boolean;
    accentColor: string;
    autoRefreshSeconds: number;
  };
}

export interface IqamaScheduleItemRequest {
  salah: SalahType;
  time: string;
  note?: string;
  offsetMinutes?: number | null;
}

export interface IqamaScheduleUpsertRequest {
  organizationId: string;
  effectiveDate: string;
  entries: IqamaScheduleItemRequest[];
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ── Islamic Content Library ──────────────────────────────────────────────────
export interface IslamicContentSyncState {
  key: string;
  provider: 'quran' | 'hadith';
  scope: string;
  status: 'idle' | 'queued' | 'running' | 'complete' | 'failed';
  processedItems: number;
  totalItems: number;
  message?: string;
  startedAtUtc?: string;
  completedAtUtc?: string;
  updatedAtUtc: string;
}

export interface IslamicContentSummary {
  quran: {
    editionCount: number;
    textEditionCount: number;
    audioEditionCount: number;
    languageCount: number;
    cachedPayloads: number;
    cachedBytes: number;
    upstreamServer: string;
    endpointCount: number;
    endpointTemplates: string[];
  };
  hadith: {
    configured: boolean;
    bookCount: number;
    chapterCount: number;
    recordCount: number;
    languages: string[];
    languageCoverage: { ar: number; en: number; ur: number };
  };
  publicApi: {
    capabilities: string;
    quranBase: string;
    hadithBase: string;
  };
  syncStates: IslamicContentSyncState[];
}

export interface QuranEdition {
  identifier: string;
  language: string;
  name: string;
  englishName: string;
  format: 'text' | 'audio' | string;
  type: string;
  direction?: string;
  syncedAtUtc: string;
}

export interface QuranAyah {
  number: number;
  text?: string;
  audio?: string;
  audioSecondary?: string[];
  numberInSurah: number;
  juz: number;
  page: number;
  surah: { number: number; name: string; englishName: string; englishNameTranslation?: string };
  edition: { identifier: string; language: string; name: string; englishName: string; format: string; type: string };
}

export interface QuranApiResponse<T> {
  code: number;
  status: string;
  data: T;
}

export interface HadithBook {
  id: number;
  slug: string;
  name: string;
  writerName: string;
  aboutWriter?: string;
  writerDeath?: string;
  hadithCount: number;
  chapterCount: number;
  languages: string[];
  syncedAtUtc: string;
}

export interface HadithRecord {
  id: number;
  hadithNumber: string;
  bookSlug: string;
  chapterNumber?: number;
  volume?: number;
  status?: string;
  englishNarrator?: string;
  urduNarrator?: string;
  hadithEnglish?: string;
  hadithUrdu?: string;
  hadithArabic?: string;
  headingEnglish?: string;
  headingUrdu?: string;
  headingArabic?: string;
  syncedAtUtc: string;
}
