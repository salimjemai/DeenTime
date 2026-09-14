import { DateTime, IANAZone } from 'luxon';
import type { TimeOnly } from '../common/json.js';

/**
 * IANA time-zone helpers standing in for System.TimeZoneInfo. Offsets are in
 * minutes east of UTC (negative for the Americas), like TimeSpan.TotalMinutes.
 */

/** TimeZoneNotFoundException. */
export class TimeZoneNotFoundError extends Error {
  constructor(zoneId: string) {
    super(`The time zone ID '${zoneId}' was not found on the local computer.`);
    this.name = 'TimeZoneNotFoundError';
  }
}

/** tzdata names only (America/Chicago, Etc/GMT+5, EST5EDT); Intl would also accept "+05:30"-style offsets. */
const ZONE_ID = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** TimeZoneInfo.FindSystemTimeZoneById succeeds for the id (IANA ids such as America/Chicago). */
export function isValidTimeZone(id: string): boolean {
  return ZONE_ID.test(id) && IANAZone.isValidZone(id);
}

/** TimeZoneInfo.GetUtcOffset: the offset in effect at the instant (DST included). */
export function zoneOffsetMinutes(zoneId: string, instant: Date): number {
  return requireZone(zoneId).offset(instant.getTime());
}

/**
 * TimeZoneInfo.BaseUtcOffset: the standard (non-DST) offset, taken as the
 * smaller of the offsets in effect on Jan 1 and Jul 1 of the year so it works
 * in both hemispheres.
 */
export function baseUtcOffsetMinutes(zoneId: string, year: number): number {
  const zone = requireZone(zoneId);
  return Math.min(zone.offset(Date.UTC(year, 0, 1)), zone.offset(Date.UTC(year, 6, 1)));
}

/** TimeZoneInfo.ConvertTimeFromUtc reduced to the wall clock in the zone. */
export function utcToZoneClock(utc: Date, zoneId: string): TimeOnly {
  const local = DateTime.fromJSDate(utc, { zone: requireZone(zoneId) });
  return { hour: local.hour, minute: local.minute, second: local.second };
}

/**
 * DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, zone)) as the
 * UTC-midnight Date used for "date" columns (see /timings/today, /public/display).
 */
export function todayInZone(zoneId: string, now: Date = new Date()): Date {
  const local = DateTime.fromJSDate(now, { zone: requireZone(zoneId) });
  return new Date(Date.UTC(local.year, local.month - 1, local.day));
}

function requireZone(zoneId: string): IANAZone {
  const zone = IANAZone.create(zoneId);
  if (!zone.isValid) throw new TimeZoneNotFoundError(zoneId);
  return zone;
}
