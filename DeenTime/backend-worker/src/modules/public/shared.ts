/**
 * Small pure helpers the public and publish modules read from other backend-node modules,
 * copied here so these two modules do not depend on files owned by other modules:
 *  - normalizeTheme          ← modules/design/design.schemas.ts
 *  - latestEntriesPerSalah   ← modules/iqama/iqama.mapper.ts
 *  - DEFAULT_IQAMA_HEADINGS  ← startup/startup.service.ts
 *  - criteria row → calculator input ← modules/organizations/organization.mapper.ts
 */
import { fromDbBool } from '../../core/db.js';
import { dateOnlyFromDb, toNumber } from '../../core/json.js';
import type { PrayerCriteriaInput } from '../../domain/prayer-times.js';

/** DesignController.NormalizeTheme: blank and "light" are "default"; everything else is lower-cased. */
export function normalizeTheme(theme: string | null | undefined): string {
  return !theme?.trim() || theme.toLowerCase() === 'light' ? 'default' : theme.toLowerCase();
}

/** IqamaController.Current / PublicController / readiness: latest entry per Salah with Date <= effective date. */
export function latestEntriesPerSalah<T extends { salah: number; date: Date; updatedAtUtc: Date }>(entries: T[]): T[] {
  const latest = new Map<number, T>();
  for (const entry of [...entries].sort((a, b) => a.date.getTime() - b.date.getTime() || a.updatedAtUtc.getTime() - b.updatedAtUtc.getTime())) {
    latest.set(entry.salah, entry);
  }
  return [...latest.values()];
}

export const DEFAULT_IQAMA_HEADINGS = ['FAJR', 'IQM*', 'SUNRISE', 'DUHUR', 'IQM*', 'ASR', 'IQM*', 'SUNSET', 'ISHA', 'IQM*'];

/** The PrayerTimingCriteria columns the calculator reads, as D1 returns them. */
export interface CriteriaDbRow {
  Method: string;
  JuristicMethodAsr: string;
  Latitude: number;
  Longitude: number;
  TimezoneId: string;
  DstObserved: number;
  DstBegins: string | null;
  DstEnds: string | null;
  MinutesAfterZawal: number;
  MinutesAfterMaghrib: number;
  KhutbahTimeMinutes: number;
}

export const CRITERIA_COLUMNS =
  '"Method", "JuristicMethodAsr", "Latitude", "Longitude", "TimezoneId", "DstObserved", "DstBegins", "DstEnds", "MinutesAfterZawal", "MinutesAfterMaghrib", "KhutbahTimeMinutes"';

/** criteriaToCalculatorInput for a D1 row. */
export function criteriaRowToCalculatorInput(row: CriteriaDbRow): PrayerCriteriaInput {
  return {
    method: row.Method,
    juristicMethodAsr: row.JuristicMethodAsr,
    latitude: toNumber(row.Latitude),
    longitude: toNumber(row.Longitude),
    timezoneId: row.TimezoneId,
    dstObserved: fromDbBool(row.DstObserved),
    dstBegins: row.DstBegins ? dateOnlyFromDb(row.DstBegins) : null,
    dstEnds: row.DstEnds ? dateOnlyFromDb(row.DstEnds) : null,
    minutesAfterZawal: row.MinutesAfterZawal,
    minutesAfterMaghrib: row.MinutesAfterMaghrib,
  };
}

/** The HijriMonthMaps columns of an anchor, as D1 returns them. */
export interface HijriMapDbRow {
  Year: number;
  Month: number;
  HijriDayOnFirst: number;
  HijriMonthOnFirst: number;
  HijriYearOnFirst: number;
}

export const HIJRI_MAP_COLUMNS = '"Year", "Month", "HijriDayOnFirst", "HijriMonthOnFirst", "HijriYearOnFirst"';

export function hijriAnchorFromRow(row: HijriMapDbRow): { year: number; month: number; hijriDayOnFirst: number; hijriMonthOnFirst: number; hijriYearOnFirst: number } {
  return { year: row.Year, month: row.Month, hijriDayOnFirst: row.HijriDayOnFirst, hijriMonthOnFirst: row.HijriMonthOnFirst, hijriYearOnFirst: row.HijriYearOnFirst };
}
