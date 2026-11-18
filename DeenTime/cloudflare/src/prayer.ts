/**
 * Daily prayer times for a masjid, computed in the Worker with the same calculator the
 * Node API uses (backend-node/src/domain), so both hosts agree on every minute.
 */
import { computePrayerTimes, toPrayerTimesDto, type PrayerTimesDto } from '../../backend-node/src/domain/prayer-times.js';
import { baseUtcOffsetMinutes, isValidTimeZone, todayInZone, zoneOffsetMinutes } from '../../backend-node/src/domain/timezone.js';

export const CALCULATION_METHODS = ['ISNA', 'MWL', 'Egyptian', 'Karachi', 'UmmAlQura', 'Gulf', 'Kuwait', 'Qatar', 'Tehran', 'Jafari'] as const;
export const ASR_METHODS = ['Standard', 'Hanafi'] as const;

export interface MasjidLocation {
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  calculationMethod: string;
  asrMethod: string;
}

export { isValidTimeZone };

/** Today's times in the masjid's own time zone, or null until its coordinates are set. */
export function prayerTimesFor(masjid: MasjidLocation, now: Date = new Date(), dayOffset = 0): PrayerTimesDto | null {
  if (masjid.latitude === null || masjid.longitude === null || !isValidTimeZone(masjid.timezone)) return null;
  const today = todayInZone(masjid.timezone, now);
  const date = new Date(today.getTime() + dayOffset * 86_400_000);
  return toPrayerTimesDto(
    computePrayerTimes(
      {
        method: masjid.calculationMethod,
        juristicMethodAsr: masjid.asrMethod === 'Hanafi' ? 'Hanafi' : 'Other',
        latitude: masjid.latitude,
        longitude: masjid.longitude,
        timezoneId: masjid.timezone,
        // The shared calculator decides DST from an instant about four weeks before the
        // date (a quirk it copies from the .NET code), so times run an hour off for weeks
        // after each clock change. Decide DST for the date itself and pass it explicitly.
        dstObserved: true,
        ...dstWindow(masjid.timezone, date),
        minutesAfterZawal: 5,
        minutesAfterMaghrib: 1,
      },
      date,
    ),
  );
}

/** A one-day DST window when the zone is on summer time at local noon of `date`, else an empty one. */
export function dstWindow(timezone: string, date: Date): { dstBegins: Date; dstEnds: Date } {
  const base = baseUtcOffsetMinutes(timezone, date.getUTCFullYear());
  const localNoon = new Date(date.getTime() + 12 * 3_600_000 - base * 60_000);
  const summer = zoneOffsetMinutes(timezone, localNoon) > base;
  return { dstBegins: date, dstEnds: summer ? new Date(date.getTime() + 86_400_000) : date };
}

export type SalahName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const SALAH: SalahName[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export type IqamaRule = { mode: 'none' } | { mode: 'fixed'; time: string } | { mode: 'offset'; minutes: number };
export type IqamaRules = Partial<Record<SalahName, IqamaRule>>;

/** "HH:mm" iqama time for each prayer, from the rule and that day's adhan time. */
export function iqamaTimes(rules: IqamaRules, times: PrayerTimesDto | null): Partial<Record<SalahName, string>> {
  const result: Partial<Record<SalahName, string>> = {};
  for (const salah of SALAH) {
    const rule = rules[salah];
    if (!rule || rule.mode === 'none') continue;
    if (rule.mode === 'fixed') result[salah] = rule.time;
    else if (times) result[salah] = addMinutes(times[salah].slice(0, 5), rule.minutes);
  }
  return result;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
