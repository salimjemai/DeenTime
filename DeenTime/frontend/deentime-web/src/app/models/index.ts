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
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

// ── Iqama ─────────────────────────────────────────────────────────────────────
export type SalahType = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha' | 'Jumuah';

export interface IqamaEntry {
  id: string;
  organizationId: string;
  date: string;       // YYYY-MM-DD
  salah: SalahType;
  time: string;       // HH:mm
  note?: string;
  updatedAtUtc: string;
}

export interface IqamaUpsertRequest {
  organizationId: string;
  date: string;
  salah: SalahType;
  time: string;
  note?: string;
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

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
