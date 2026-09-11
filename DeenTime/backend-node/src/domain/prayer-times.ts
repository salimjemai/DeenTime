import { formatDateOnly, formatTimeOnly, type TimeOnly } from '../common/json.js';
import { baseUtcOffsetMinutes, zoneOffsetMinutes } from './timezone.js';

/**
 * Port of DeenTime.Core.Services.IsnaCalculator: daily prayer times from the
 * organization's calculation method. Asr is Shafi'i/Maliki (shadow factor 1)
 * unless the juristic method is Hanafi (factor 2). Every formula, clamp and
 * rounding step mirrors the .NET code so both APIs emit identical schedules.
 */

/** The PrayerTimingCriteria fields the calculator reads; dates are UTC-midnight DateOnly values. */
export interface PrayerCriteriaInput {
  method: string;
  juristicMethodAsr: string;
  latitude: number;
  longitude: number;
  timezoneId: string;
  dstObserved: boolean;
  dstBegins: Date | null;
  dstEnds: Date | null;
  minutesAfterZawal: number;
  minutesAfterMaghrib: number;
}

/** PrayerTimesDto before serialization; seconds are always 0 (new TimeOnly(hour, minute)). */
export interface PrayerTimes {
  date: Date;
  fajr: TimeOnly;
  sunrise: TimeOnly;
  dhuhr: TimeOnly;
  asr: TimeOnly;
  maghrib: TimeOnly;
  sunset: TimeOnly;
  isha: TimeOnly;
}

/** PrayerTimesDto as System.Text.Json writes it: "2026-08-19" and "05:50:00". */
export interface PrayerTimesDto {
  date: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  sunset: string;
  isha: string;
}

interface MethodAngles {
  fajrAngle: number;
  ishaAngle: number;
  /** Isha at sunset + n minutes instead of a solar angle (Umm al-Qura, Gulf, Qatar). */
  fixedIshaMinutes: number | null;
}

/** Keyed by Method with spaces and dashes removed, lower-cased; anything else (incl. ISNA) is 15°/15°. */
const METHOD_ANGLES = new Map<string, MethodAngles>([
  ['karachi', { fajrAngle: 18.0, ishaAngle: 18.0, fixedIshaMinutes: null }],
  ['mwl', { fajrAngle: 18.0, ishaAngle: 17.0, fixedIshaMinutes: null }],
  ['muslimworldleague', { fajrAngle: 18.0, ishaAngle: 17.0, fixedIshaMinutes: null }],
  ['ummalqura', { fajrAngle: 18.5, ishaAngle: 0.0, fixedIshaMinutes: 90 }],
  ['egyptian', { fajrAngle: 19.5, ishaAngle: 17.5, fixedIshaMinutes: null }],
  ['gulf', { fajrAngle: 19.5, ishaAngle: 0.0, fixedIshaMinutes: 90 }],
  ['kuwait', { fajrAngle: 18.0, ishaAngle: 17.5, fixedIshaMinutes: null }],
  ['qatar', { fajrAngle: 18.0, ishaAngle: 0.0, fixedIshaMinutes: 90 }],
  ['tehran', { fajrAngle: 17.7, ishaAngle: 14.0, fixedIshaMinutes: null }],
  ['jafari', { fajrAngle: 16.0, ishaAngle: 14.0, fixedIshaMinutes: null }],
]);
const DEFAULT_ANGLES: MethodAngles = { fajrAngle: 15.0, ishaAngle: 15.0, fixedIshaMinutes: null };

const TICKS_PER_MINUTE = 600_000_000;
const TICKS_PER_HOUR = 36_000_000_000;
const TICKS_PER_DAY = 864_000_000_000;

export function computePrayerTimes(c: PrayerCriteriaInput, date: Date): PrayerTimes {
  const lat = c.latitude;
  const lng = c.longitude;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  // Days since J2000.0
  const D = julianDay(year, month, day) - 2451545.0;

  // Solar mean anomaly and mean longitude (degrees)
  const g = toRad(357.529 + 0.98560028 * D);
  const q = 280.459 + 0.98564736 * D;
  const L = toRad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));

  // Obliquity of the ecliptic and solar declination
  const e = toRad(23.439 - 0.00000036 * D);
  const decl = Math.asin(Math.sin(e) * Math.sin(L));

  // Right ascension (hours)
  let RA = (Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * 12.0) / Math.PI;
  if (RA < 0) RA += 24.0;

  // Equation of time (hours). Like the .NET code, q is not reduced modulo 360°, so
  // EqT (and every UTC hour below) carries a multiple of 24 h that the single ±12
  // wrap does not remove: the wall clock is unaffected, but the instant handed to
  // the IANA conversion lies days before `date`, which is where DST gets decided.
  let EqT = q / 15.0 - RA;
  if (EqT > 12) EqT -= 24;
  if (EqT < -12) EqT += 24;

  // Solar noon in UTC hours
  const noon = 12.0 - lng / 15.0 - EqT;

  // Hour angle for a given altitude (degrees); returns hours
  const hourAngle = (altDeg: number): number => {
    const cosH = (Math.sin(toRad(altDeg)) - Math.sin(toRad(lat)) * Math.sin(decl)) / (Math.cos(toRad(lat)) * Math.cos(decl));
    if (cosH <= -1) return 12.0;
    if (cosH >= 1) return 0.0;
    return toDeg(Math.acos(cosH)) / 15.0;
  };

  const method = toLowerInvariant(c.method.replaceAll(' ', '').replaceAll('-', ''));
  const { fajrAngle, ishaAngle, fixedIshaMinutes } = METHOD_ANGLES.get(method) ?? DEFAULT_ANGLES;
  const fajrHours = noon - hourAngle(-fajrAngle);

  // Sunrise: sun at -0.8333° (accounts for refraction + solar disk radius)
  const sunriseHours = noon - hourAngle(-0.8333);

  // Dhuhr: solar noon + configured offset
  const dhuhrHours = noon + c.minutesAfterZawal / 60.0;

  // Asr: Shafi'i (factor 1) or Hanafi (factor 2)
  const shadow = equalsOrdinalIgnoreCase(c.juristicMethodAsr, 'Hanafi') ? 2 : 1;
  const asrAlt = toDeg(Math.atan(1.0 / (shadow + Math.tan(Math.abs(decl - toRad(lat))))));
  const asrHours = noon + hourAngle(asrAlt);

  // Sunset: sun at -0.8333°
  const sunsetHours = noon + hourAngle(-0.8333);

  // Maghrib: sunset + configured offset
  const maghribHours = sunsetHours + c.minutesAfterMaghrib / 60.0;
  const ishaHours = fixedIshaMinutes !== null ? sunsetHours + fixedIshaMinutes / 60.0 : noon + hourAngle(-ishaAngle);

  // Convert UTC decimal hours to local TimeOnly (FindSystemTimeZoneById throws for unknown zones in every mode)
  const midnightUtcMs = Date.UTC(year, month - 1, day);
  const baseOffsetMinutes = baseUtcOffsetMinutes(c.timezoneId, year);
  const { dstBegins, dstEnds } = c;
  const customDstWindow = dstBegins !== null && dstEnds !== null;
  const customDst =
    dstBegins !== null && dstEnds !== null && midnightUtcMs >= dateOnlyMs(dstBegins) && midnightUtcMs < dateOnlyMs(dstEnds);

  const toLocal = (utcHour: number): TimeOnly => {
    const ticks = dateTimeAddHoursTicks(utcHour);
    let offsetMinutes: number;
    if (!c.dstObserved) {
      offsetMinutes = baseOffsetMinutes;
    } else if (customDstWindow) {
      offsetMinutes = baseOffsetMinutes + (customDst ? 60 : 0);
    } else {
      offsetMinutes = zoneOffsetMinutes(c.timezoneId, new Date(midnightUtcMs + Math.floor(ticks / 10_000)));
    }
    const localTicks = mod(ticks + offsetMinutes * TICKS_PER_MINUTE, TICKS_PER_DAY);
    return { hour: Math.floor(localTicks / TICKS_PER_HOUR), minute: Math.floor(localTicks / TICKS_PER_MINUTE) % 60, second: 0 };
  };

  return {
    date: new Date(midnightUtcMs),
    fajr: toLocal(fajrHours),
    sunrise: toLocal(sunriseHours),
    dhuhr: toLocal(dhuhrHours),
    asr: toLocal(asrHours),
    maghrib: toLocal(maghribHours),
    sunset: toLocal(sunsetHours),
    isha: toLocal(ishaHours),
  };
}

export function toPrayerTimesDto(times: PrayerTimes): PrayerTimesDto {
  return {
    date: formatDateOnly(times.date),
    fajr: formatTimeOnly(times.fajr),
    sunrise: formatTimeOnly(times.sunrise),
    dhuhr: formatTimeOnly(times.dhuhr),
    asr: formatTimeOnly(times.asr),
    maghrib: formatTimeOnly(times.maghrib),
    sunset: formatTimeOnly(times.sunset),
    isha: formatTimeOnly(times.isha),
  };
}

/**
 * Ticks (100 ns) that DateTime.AddHours(double) adds: the integral hours plus
 * the fractional part, each truncated to whole ticks (no millisecond rounding).
 */
export function dateTimeAddHoursTicks(hours: number): number {
  const integral = Math.trunc(hours);
  return integral * TICKS_PER_HOUR + Math.trunc((hours - integral) * TICKS_PER_HOUR);
}

function julianDay(y: number, m: number, d: number): number {
  if (m <= 2) {
    y--;
    m += 12;
  }
  const A = Math.trunc(y / 100);
  const B = 2 - A + Math.trunc(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180.0;
}

function toDeg(rad: number): number {
  return (rad * 180.0) / Math.PI;
}

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function dateOnlyMs(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** string.ToLowerInvariant(): simple per-code-point mapping; U+0130 (capital I with dot) lowercases to itself. */
function toLowerInvariant(value: string): string {
  return Array.from(value, (ch) => (ch === '\u0130' ? ch : ch.toLowerCase())).join('');
}

/** string.Equals(a, b, StringComparison.OrdinalIgnoreCase). */
function equalsOrdinalIgnoreCase(a: string, b: string): boolean {
  return a.length === b.length && a.toUpperCase() === b.toUpperCase();
}
