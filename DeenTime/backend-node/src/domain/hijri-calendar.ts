/**
 * Port of System.Globalization.HijriCalendar (the tabular Islamic calendar) with the
 * default HijriAdjustment = 0, which is what the .NET API gets on Linux/macOS.
 *
 * Gregorian values are DateOnly-style UTC-midnight Dates and every computation works in
 * whole days using .NET's day numbering (0001-01-01 is day index 0 / absolute day 1;
 * 1 Muharram 1 AH is day index 227013 = 0622-07-18). Supported range: 0622-07-18 ..
 * 9999-12-31, i.e. Hijri 1/1/1 .. 9666/4/3. Invalid or out-of-range values throw a
 * RangeError where .NET throws ArgumentOutOfRangeException.
 */
export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

export const HIJRI_MONTH_NAMES = [
  'Muharram',
  'Safar',
  'Rabi al-Awwal',
  'Rabi al-Thani',
  'Jumada al-Awwal',
  'Jumada al-Thani',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qi'dah",
  'Dhu al-Hijjah',
] as const;

/** HijriCalendar.HijriMonthDays: days elapsed before each month of a Hijri year. */
const HIJRI_MONTH_DAYS = [
  0, 30, 59, 89, 118, 148, 177, 207, 236, 266, 295, 325, 355,
] as const;
const HIJRI_ADJUSTMENT = 0;
const MAX_CALENDAR_YEAR = 9666;
const MAX_CALENDAR_MONTH = 4;
const DAYS_PER_30_YEAR_CYCLE = 10_631;
/** Absolute day (1-based) of the day before 1 Muharram 1 AH; DaysUpToHijriYear(1). */
const DAYS_BEFORE_HIJRI_EPOCH = 227_013;
const MS_PER_DAY = 86_400_000;
/** DateTime(1970, 1, 1).Ticks / TicksPerDay. */
const UNIX_EPOCH_DAY_INDEX = 719_162;
/** Day index of 0622-07-18 (HijriCalendar.MinSupportedDateTime). */
const MIN_DAY_INDEX = 227_013;
/** Day index of 9999-12-31 (DateTime.MaxValue). */
const MAX_DAY_INDEX = 3_652_058;

/** A UTC-midnight Date for a proleptic Gregorian year/month/day, exact for every year (Date.UTC maps 0..99 to 1900..1999). */
export function utcDateOnly(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function dayIndexOf(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY) + UNIX_EPOCH_DAY_INDEX;
}

function dateFromDayIndex(dayIndex: number): Date {
  return new Date((dayIndex - UNIX_EPOCH_DAY_INDEX) * MS_PER_DAY);
}

/** HijriCalendar.CheckYearRange. */
function checkYearRange(year: number): void {
  if (!Number.isInteger(year) || year < 1 || year > MAX_CALENDAR_YEAR) {
    throw new RangeError(
      `Hijri year must be between 1 and ${MAX_CALENDAR_YEAR}, got ${year}.`,
    );
  }
}

/** HijriCalendar.CheckYearMonthRange. */
function checkYearMonthRange(year: number, month: number): void {
  checkYearRange(year);
  if (year === MAX_CALENDAR_YEAR && month > MAX_CALENDAR_MONTH) {
    throw new RangeError(
      `Hijri month must be between 1 and ${MAX_CALENDAR_MONTH} in year ${MAX_CALENDAR_YEAR}, got ${month}.`,
    );
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Hijri month must be between 1 and 12, got ${month}.`);
  }
}

/** HijriCalendar.IsLeapYear: leap years are 2, 5, 7, 10, 13, 16, 18, 21, 24, 26 and 29 of each 30-year cycle. */
export function isHijriLeapYear(year: number): boolean {
  checkYearRange(year);
  return (year * 11 + 14) % 30 < 11;
}

/** HijriCalendar.GetDaysInMonth: months alternate 30/29 days; Dhu al-Hijjah has 30 in a leap year. */
export function hijriDaysInMonth(year: number, month: number): number {
  checkYearMonthRange(year, month);
  if (month === 12) return isHijriLeapYear(year) ? 30 : 29;
  return month % 2 === 1 ? 30 : 29;
}

/** HijriCalendar.GetDaysInYear. */
function hijriDaysInYear(year: number): number {
  checkYearRange(year);
  return isHijriLeapYear(year) ? 355 : 354;
}

/** HijriCalendar.DaysUpToHijriYear: absolute day (1-based) of the day before 1 Muharram of the year. */
function daysUpToHijriYear(hijriYear: number): number {
  const numYear30 = Math.trunc((hijriYear - 1) / 30) * 30;
  let numYearsLeft = hijriYear - numYear30 - 1;
  let numDays =
    Math.trunc((numYear30 * DAYS_PER_30_YEAR_CYCLE) / 30) +
    DAYS_BEFORE_HIJRI_EPOCH;
  while (numYearsLeft > 0) {
    numDays += 354 + (isHijriLeapYear(numYearsLeft) ? 1 : 0);
    numYearsLeft--;
  }
  return numDays;
}

/** HijriCalendar.GetAbsoluteDateHijri: the 0-based day index of a Hijri date. */
function absoluteDateHijri(year: number, month: number, day: number): number {
  return (
    daysUpToHijriYear(year) +
    HIJRI_MONTH_DAYS[month - 1] +
    day -
    1 -
    HIJRI_ADJUSTMENT
  );
}

/** HijriCalendar.GetYear/GetMonth/GetDayOfMonth (GetDatePart) for a UTC-midnight DateOnly. */
export function hijriFromGregorian(date: Date): HijriDate {
  const dayIndex = dayIndexOf(date);
  if (
    Number.isNaN(dayIndex) ||
    dayIndex < MIN_DAY_INDEX ||
    dayIndex > MAX_DAY_INDEX
  ) {
    throw new RangeError(
      'Date is outside the range supported by the Hijri calendar (0622-07-18 .. 9999-12-31).',
    );
  }

  // Absolute date: 0001-01-01 is day 1.
  let numDays = dayIndex + 1 + HIJRI_ADJUSTMENT;

  // Approximate the Hijri year, then correct it against the exact year boundaries.
  let hijriYear =
    Math.trunc(
      ((numDays - DAYS_BEFORE_HIJRI_EPOCH) * 30) / DAYS_PER_30_YEAR_CYCLE,
    ) + 1;
  let daysToHijriYear = daysUpToHijriYear(hijriYear);
  const daysOfHijriYear = hijriDaysInYear(hijriYear);
  if (numDays < daysToHijriYear) {
    daysToHijriYear -= daysOfHijriYear;
    hijriYear--;
  } else if (numDays === daysToHijriYear) {
    hijriYear--;
    daysToHijriYear -= hijriDaysInYear(hijriYear);
  } else if (numDays > daysToHijriYear + daysOfHijriYear) {
    daysToHijriYear += daysOfHijriYear;
    hijriYear++;
  }

  numDays -= daysToHijriYear;
  let hijriMonth = 1;
  while (hijriMonth <= 12 && numDays > HIJRI_MONTH_DAYS[hijriMonth - 1])
    hijriMonth++;
  hijriMonth--;
  const hijriDay = numDays - HIJRI_MONTH_DAYS[hijriMonth - 1];
  return { year: hijriYear, month: hijriMonth, day: hijriDay };
}

/** HijriCalendar.ToDateTime(year, month, day, 0, 0, 0, 0) as a UTC-midnight DateOnly. */
export function hijriToGregorian(
  year: number,
  month: number,
  day: number,
): Date {
  const daysInMonth = hijriDaysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    throw new RangeError(
      `Hijri day must be between 1 and ${daysInMonth} for month ${month}, got ${day}.`,
    );
  }
  const dayIndex = absoluteDateHijri(year, month, day);
  // new DateTime(ticks) rejects anything past DateTime.MaxValue (Hijri 9666/4/3 = 9999-12-31).
  if (dayIndex < 0 || dayIndex > MAX_DAY_INDEX) {
    throw new RangeError(
      `Hijri date ${year}/${month}/${day} is outside the supported range.`,
    );
  }
  return dateFromDayIndex(dayIndex);
}
