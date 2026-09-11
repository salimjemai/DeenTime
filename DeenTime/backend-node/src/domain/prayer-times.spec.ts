import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDateOnly, parseDateOnly, timeOnly } from '../common/json.js';
import {
  computePrayerTimes,
  dateTimeAddHoursTicks,
  toPrayerTimesDto,
  type PrayerCriteriaInput,
  type PrayerTimesDto,
} from './prayer-times.js';
import {
  TimeZoneNotFoundError,
  baseUtcOffsetMinutes,
  isValidTimeZone,
  todayInZone,
  utcToZoneClock,
  zoneOffsetMinutes,
} from './timezone.js';

interface FixtureLocation {
  latitude: number;
  longitude: number;
  timezoneId: string;
  dstObserved: boolean;
  dstBegins: string | null;
  dstEnds: string | null;
  minutesAfterZawal: number;
  minutesAfterMaghrib: number;
}

interface FixtureCase {
  location: string;
  method: string;
  juristicMethodAsr: string;
  expected: PrayerTimesDto;
}

interface Fixture {
  locations: Record<string, FixtureLocation>;
  timeZones: Record<string, { baseUtcOffsetMinutes: number }>;
  cases: FixtureCase[];
  addHoursProbe: { hours: number; ticks: number }[];
}

/** Written by __fixtures__/prayer-times.generator.cs.txt running the real DeenTime.Core IsnaCalculator. */
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/prayer-times.json', import.meta.url), 'utf8')) as Fixture;

/** The criteria of PrayerTimeCalculatorTests.Cedar_Park_ISNA_schedule_stays_in_the_correct_local_day. */
const CEDAR_PARK: PrayerCriteriaInput = {
  method: 'ISNA',
  juristicMethodAsr: 'Other',
  latitude: 30.5052,
  longitude: -97.8203,
  timezoneId: 'America/Chicago',
  dstObserved: true,
  dstBegins: null,
  dstEnds: null,
  minutesAfterZawal: 5,
  minutesAfterMaghrib: 1,
};

function dateOnly(value: string): Date {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error(`Invalid fixture date ${value}`);
  return parsed;
}

function criteriaFor(location: string, method: string, juristicMethodAsr: string): PrayerCriteriaInput {
  const place = fixture.locations[location];
  if (!place) throw new Error(`Unknown fixture location ${location}`);
  return {
    method,
    juristicMethodAsr,
    latitude: place.latitude,
    longitude: place.longitude,
    timezoneId: place.timezoneId,
    dstObserved: place.dstObserved,
    dstBegins: place.dstBegins === null ? null : dateOnly(place.dstBegins),
    dstEnds: place.dstEnds === null ? null : dateOnly(place.dstEnds),
    minutesAfterZawal: place.minutesAfterZawal,
    minutesAfterMaghrib: place.minutesAfterMaghrib,
  };
}

function dto(criteria: PrayerCriteriaInput, date: string): PrayerTimesDto {
  return toPrayerTimesDto(computePrayerTimes(criteria, dateOnly(date)));
}

describe('computePrayerTimes', () => {
  it('reproduces the Cedar Park ISNA schedule from PrayerTimeCalculatorTests', () => {
    const result = computePrayerTimes(CEDAR_PARK, dateOnly('2026-08-19'));
    expect(formatDateOnly(result.date)).toBe('2026-08-19');
    expect(result.fajr).toEqual(timeOnly(5, 50));
    expect(result.sunrise).toEqual(timeOnly(7, 0));
    expect(result.dhuhr).toEqual(timeOnly(13, 40));
    expect(result.asr).toEqual(timeOnly(17, 11));
    expect(result.maghrib).toEqual(timeOnly(20, 10));
    expect(result.isha).toEqual(timeOnly(21, 20));
  });

  it('serializes PrayerTimesDto exactly like System.Text.Json (property order, HH:mm:ss)', () => {
    const first = fixture.cases[0];
    const serialized = JSON.stringify(dto(criteriaFor(first.location, first.method, first.juristicMethodAsr), first.expected.date));
    expect(serialized).toBe(JSON.stringify(first.expected));
    expect(dto(CEDAR_PARK, '2026-08-19')).toEqual({
      date: '2026-08-19',
      fajr: '05:50:00',
      sunrise: '07:00:00',
      dhuhr: '13:40:00',
      asr: '17:11:00',
      maghrib: '20:10:00',
      sunset: '20:09:00',
      isha: '21:20:00',
    });
  });

  it('normalizes the method key like the .NET switch (spaces and dashes removed, case-insensitive)', () => {
    const on = (method: string): PrayerTimesDto => dto({ ...CEDAR_PARK, method }, '2026-06-21');
    expect(on('muslim-world-league')).toEqual(on('MWL'));
    expect(on('Muslim World League')).toEqual(on('mwl'));
    expect(on('Umm Al-Qura')).toEqual(on('ummalqura'));
    expect(on('umm al qura')).toEqual(on('UmmAlQura'));
    expect(on('nonsense')).toEqual(on('ISNA'));
    expect(on('constructor')).toEqual(on('ISNA'));
    expect(on('MWL')).not.toEqual(on('ISNA'));
  });

  it('compares the Asr juristic method ordinally, ignoring case', () => {
    const on = (juristicMethodAsr: string): PrayerTimesDto => dto({ ...CEDAR_PARK, juristicMethodAsr }, '2026-06-21');
    expect(on('hanafi')).toEqual(on('Hanafi'));
    expect(on('HANAFI')).toEqual(on('Hanafi'));
    expect(on("Shafi'i")).toEqual(on('Other'));
    expect(on('Hanafi').asr).not.toBe(on('Other').asr);
  });

  it('decides IANA DST at the same unnormalized instant as .NET', () => {
    // q is never reduced modulo 360°, so the instant converted with the IANA rules
    // lies ~25 days before the date in 2026: DST starts/ends about four weeks late.
    expect(dto(CEDAR_PARK, '2026-03-08').dhuhr).toBe('12:47:00');
    expect(dto(CEDAR_PARK, '2026-03-29').dhuhr).toBe('12:41:00');
    expect(dto(CEDAR_PARK, '2026-04-05').dhuhr).toBe('13:39:00');
    expect(dto(CEDAR_PARK, '2026-11-01').dhuhr).toBe('13:19:00');
    expect(dto(CEDAR_PARK, '2026-11-22').dhuhr).toBe('13:22:00');
    expect(dto(CEDAR_PARK, '2026-11-29').dhuhr).toBe('12:24:00');
  });

  it('applies the custom DST window as base offset + 1h for dstBegins <= date < dstEnds', () => {
    const custom = criteriaFor('cedarParkCustomDst', 'ISNA', 'Other');
    const standard = criteriaFor('cedarParkNoDst', 'ISNA', 'Other');
    expect(dto(custom, '2026-03-07')).toEqual(dto(standard, '2026-03-07'));
    expect(dto(custom, '2026-03-08').dhuhr).toBe('13:47:00');
    expect(dto(standard, '2026-03-08').dhuhr).toBe('12:47:00');
    expect(dto(custom, '2026-10-31').dhuhr).toBe('13:19:00');
    expect(dto(custom, '2026-11-01')).toEqual(dto(standard, '2026-11-01'));
  });

  it('clamps the hour angle to 12h when the sun never reaches the Fajr/Isha angle (Anchorage in June)', () => {
    const result = computePrayerTimes(criteriaFor('anchorage', 'ISNA', 'Other'), dateOnly('2026-06-21'));
    expect(result.fajr).toEqual(timeOnly(2, 1));
    expect(result.isha).toEqual(result.fajr);
  });

  it('rejects unknown time zones in every mode like FindSystemTimeZoneById', () => {
    const date = dateOnly('2026-08-19');
    const unknown = { ...CEDAR_PARK, timezoneId: 'Mars/Olympus' };
    expect(() => computePrayerTimes(unknown, date)).toThrow(TimeZoneNotFoundError);
    expect(() => computePrayerTimes({ ...unknown, dstObserved: false }, date)).toThrow(TimeZoneNotFoundError);
    expect(() => computePrayerTimes({ ...unknown, dstBegins: dateOnly('2026-03-08'), dstEnds: dateOnly('2026-11-01') }, date)).toThrow(
      TimeZoneNotFoundError,
    );
  });

  describe('matches the .NET IsnaCalculator fixture', () => {
    it('covers every method, Asr method, location and date', () => {
      expect(fixture.cases).toHaveLength(600);
      expect(new Set(fixture.cases.map((c) => c.method)).size).toBe(12);
      expect(new Set(fixture.cases.map((c) => c.juristicMethodAsr))).toEqual(new Set(['Hanafi', 'Other']));
      expect(new Set(fixture.cases.map((c) => c.location)).size).toBe(5);
      expect(new Set(fixture.cases.map((c) => c.expected.date)).size).toBe(5);
    });

    for (const fixtureCase of fixture.cases) {
      it(`${fixtureCase.location} ${fixtureCase.method} ${fixtureCase.juristicMethodAsr} ${fixtureCase.expected.date}`, () => {
        const criteria = criteriaFor(fixtureCase.location, fixtureCase.method, fixtureCase.juristicMethodAsr);
        expect(dto(criteria, fixtureCase.expected.date)).toEqual(fixtureCase.expected);
      });
    }
  });
});

describe('dateTimeAddHoursTicks', () => {
  it('truncates to 100ns ticks like DateTime.AddHours(double)', () => {
    for (const probe of fixture.addHoursProbe) {
      expect(dateTimeAddHoursTicks(probe.hours), `${probe.hours} h`).toBe(probe.ticks);
    }
  });
});

describe('timezone', () => {
  it('reports BaseUtcOffset like TimeZoneInfo', () => {
    for (const [zoneId, probe] of Object.entries(fixture.timeZones)) {
      expect(baseUtcOffsetMinutes(zoneId, 2026), zoneId).toBe(probe.baseUtcOffsetMinutes);
    }
    expect(baseUtcOffsetMinutes('Australia/Sydney', 2026)).toBe(600);
    expect(baseUtcOffsetMinutes('Europe/London', 2026)).toBe(0);
    expect(baseUtcOffsetMinutes('Asia/Kolkata', 2026)).toBe(330);
  });

  it('follows the real DST transitions for an instant', () => {
    expect(zoneOffsetMinutes('America/Chicago', new Date('2026-03-08T07:59:59Z'))).toBe(-360);
    expect(zoneOffsetMinutes('America/Chicago', new Date('2026-03-08T08:00:00Z'))).toBe(-300);
    expect(zoneOffsetMinutes('America/Chicago', new Date('2026-11-01T06:59:59Z'))).toBe(-300);
    expect(zoneOffsetMinutes('America/Chicago', new Date('2026-11-01T07:00:00Z'))).toBe(-360);
    expect(zoneOffsetMinutes('Pacific/Honolulu', new Date('2026-06-21T00:00:00Z'))).toBe(-600);
  });

  it('accepts IANA ids only', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('Etc/GMT+5')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('Central Standard Time')).toBe(false);
    expect(isValidTimeZone('+05:30')).toBe(false);
  });

  it('converts a UTC instant to the wall clock of the zone', () => {
    expect(utcToZoneClock(new Date('2026-08-19T10:50:30Z'), 'America/Chicago')).toEqual({ hour: 5, minute: 50, second: 30 });
    expect(utcToZoneClock(new Date('2026-01-15T03:05:00Z'), 'America/Chicago')).toEqual({ hour: 21, minute: 5, second: 0 });
    expect(utcToZoneClock(new Date('2026-06-21T09:59:59Z'), 'Pacific/Honolulu')).toEqual({ hour: 23, minute: 59, second: 59 });
    expect(() => utcToZoneClock(new Date(), 'Mars/Olympus')).toThrow(TimeZoneNotFoundError);
  });

  it('returns the local calendar date as a UTC-midnight DateOnly', () => {
    expect(formatDateOnly(todayInZone('America/Chicago', new Date('2026-09-11T03:30:00Z')))).toBe('2026-09-10');
    expect(formatDateOnly(todayInZone('America/Chicago', new Date('2026-09-11T05:00:00Z')))).toBe('2026-09-11');
    expect(formatDateOnly(todayInZone('Asia/Tokyo', new Date('2026-09-10T20:00:00Z')))).toBe('2026-09-11');
    expect(todayInZone('Pacific/Honolulu', new Date('2026-06-21T09:59:59Z')).getTime()).toBe(Date.UTC(2026, 5, 20));
    expect(todayInZone('Pacific/Honolulu', new Date('2026-06-21T10:00:00Z')).getTime()).toBe(Date.UTC(2026, 5, 21));
    expect(() => todayInZone('Mars/Olympus')).toThrow(TimeZoneNotFoundError);
  });
});
