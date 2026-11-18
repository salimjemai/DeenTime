import { addDays } from '../common/json.js';
import {
  HIJRI_MONTH_NAMES,
  hijriFromGregorian,
  hijriToGregorian,
  utcDateOnly,
  type HijriDate,
} from './hijri-calendar.js';

/**
 * API-level Hijri helpers ported from HijriService.Generate, QuestPdfGenerator.GetHijriDate
 * and PublicController.BuildHijriDate. A HijriMonthMap row ("anchor") records which Hijri
 * date falls on the first day of a Gregorian year/month so that moon-sighting adjustments
 * shift the tabular calendar.
 */
export interface HijriMonthAnchor {
  year: number;
  month: number;
  hijriDayOnFirst: number;
  hijriMonthOnFirst: number;
  hijriYearOnFirst: number;
}

export interface GeneratedHijriMonthMap extends HijriMonthAnchor {
  locked: false;
}

export interface HijriDisplay {
  day: number;
  month: number;
  year: number;
  monthName: string;
  formatted: string;
}

/** Key of the anchor map consumed by ramadanDates: "year-month" without padding (e.g. "2026-3"). */
export function hijriAnchorKey(year: number, month: number): string {
  return `${year}-${month}`;
}

/** HijriService.Generate: one map per Gregorian month, from `from`'s month to `to`'s month inclusive. */
export function generateHijriMonthMaps(
  from: Date,
  to: Date,
): GeneratedHijriMonthMap[] {
  const maps: GeneratedHijriMonthMap[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth() + 1;
  const endYear = to.getUTCFullYear();
  const endMonth = to.getUTCMonth() + 1;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const hijri = hijriFromGregorian(utcDateOnly(year, month, 1));
    maps.push({
      year,
      month,
      hijriDayOnFirst: hijri.day,
      hijriMonthOnFirst: hijri.month,
      hijriYearOnFirst: hijri.year,
      locked: false,
    });
    if (month === 12) {
      month = 1;
      year++;
    } else {
      month++;
    }
  }
  return maps;
}

/** .NET only trusts an anchor that carries a real Hijri month and year (HijriMonthOnFirst > 0 && HijriYearOnFirst > 1). */
function isUsableAnchor(
  anchor: HijriMonthAnchor | null,
): anchor is HijriMonthAnchor {
  return (
    anchor !== null &&
    anchor.hijriMonthOnFirst > 0 &&
    anchor.hijriYearOnFirst > 1
  );
}

/** The Gregorian date whose tabular Hijri date is the one the anchor assigns to the 1st, advanced to the date's day. */
function anchoredDate(date: Date, anchor: HijriMonthAnchor): Date {
  const first = hijriToGregorian(
    anchor.hijriYearOnFirst,
    anchor.hijriMonthOnFirst,
    anchor.hijriDayOnFirst,
  );
  return addDays(first, date.getUTCDate() - 1);
}

/**
 * QuestPdfGenerator.GetHijriDate. The anchor must be the one for the date's Gregorian
 * year/month (or null). Throws RangeError when the anchor holds invalid Hijri values, like
 * the ArgumentOutOfRangeException .NET lets escape from the PDF generator.
 */
export function resolveHijriDate(
  date: Date,
  anchor: HijriMonthAnchor | null,
): HijriDate {
  return hijriFromGregorian(
    isUsableAnchor(anchor) ? anchoredDate(date, anchor) : date,
  );
}

/** PublicController.BuildHijriDate: null where .NET swallows ArgumentOutOfRangeException (invalid anchor values). */
export function buildHijriDisplay(
  date: Date,
  anchor: HijriMonthAnchor | null,
): HijriDisplay | null {
  try {
    const current = isUsableAnchor(anchor)
      ? anchoredDate(date, anchor)
      : addDays(
          utcDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
          date.getUTCDate() - 1,
        );
    const { year, month, day } = hijriFromGregorian(current);
    const monthName = HIJRI_MONTH_NAMES[month - 1];
    return {
      day,
      month,
      year,
      monthName,
      formatted: `${monthName} ${day}, ${year}`,
    };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** DateTime.IsLeapYear. */
function isGregorianLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * GenerateRamadanPdfAsync: every date of the Gregorian year whose resolved Hijri month is
 * Ramadan (9). `anchors` holds the organization's HijriMonthMap rows keyed by hijriAnchorKey.
 */
export function ramadanDates(
  year: number,
  anchors: ReadonlyMap<string, HijriMonthAnchor>,
): Date[] {
  const dates: Date[] = [];
  const first = utcDateOnly(year, 1, 1);
  const daysInYear = isGregorianLeapYear(year) ? 366 : 365;
  for (let offset = 0; offset < daysInYear; offset++) {
    const date = addDays(first, offset);
    const anchor =
      anchors.get(hijriAnchorKey(year, date.getUTCMonth() + 1)) ?? null;
    if (resolveHijriDate(date, anchor).month === 9) dates.push(date);
  }
  return dates;
}
