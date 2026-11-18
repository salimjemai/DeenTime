/**
 * IANA time-zone helpers on Intl only, so the module needs no npm dependency inside a
 * Worker. Offsets are in minutes east of UTC (negative for the Americas).
 */

export class TimeZoneNotFoundError extends Error {
  constructor(zoneId: string) {
    super(`The time zone ID '${zoneId}' was not found.`);
    this.name = 'TimeZoneNotFoundError';
  }
}

/** tzdata names only (America/Chicago, Etc/GMT+5); Intl would also accept "+05:30". */
const ZONE_ID = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zoneId: string): Intl.DateTimeFormat {
  let f = formatters.get(zoneId);
  if (!f) {
    if (!ZONE_ID.test(zoneId)) throw new TimeZoneNotFoundError(zoneId);
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zoneId,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      throw new TimeZoneNotFoundError(zoneId);
    }
    formatters.set(zoneId, f);
  }
  return f;
}

function wallClock(zoneId: string, ms: number) {
  const p: Record<string, number> = {};
  for (const part of formatter(zoneId).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second };
}

export function isValidTimeZone(id: string): boolean {
  try {
    formatter(id);
    return true;
  } catch {
    return false;
  }
}

/** The offset in effect at the instant (daylight time included). */
export function zoneOffsetMinutes(zoneId: string, instant: Date): number {
  const ms = Math.floor(instant.getTime() / 1000) * 1000;
  const c = wallClock(zoneId, ms);
  return Math.round((Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - ms) / 60_000);
}

/** The standard (non-daylight) offset: the smaller of Jan 1 and Jul 1, for both hemispheres. */
export function baseUtcOffsetMinutes(zoneId: string, year: number): number {
  return Math.min(zoneOffsetMinutes(zoneId, new Date(Date.UTC(year, 0, 1))), zoneOffsetMinutes(zoneId, new Date(Date.UTC(year, 6, 1))));
}

/** Today's date in the zone, as a UTC-midnight Date. */
export function todayInZone(zoneId: string, now: Date = new Date()): Date {
  const c = wallClock(zoneId, now.getTime());
  return new Date(Date.UTC(c.year, c.month - 1, c.day));
}
