import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/core/db.js';
import { addDays, parseDateOnly } from '../src/core/json.js';
import { computePrayerTimes, toPrayerTimesDto, type PrayerCriteriaInput, type PrayerTimesDto } from '../src/domain/prayer-times.js';
import { todayInZone } from '../src/domain/timezone.js';
import { createTestApp, type SeededOrganization, type TestApp } from './support/test-app.js';

const criteria: PrayerCriteriaInput = {
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

function expected(date: string): PrayerTimesDto {
  return toPrayerTimesDto(computePrayerTimes(criteria, parseDateOnly(date) as Date));
}

describe('timings', () => {
  let app: TestApp;
  let organization: SeededOrganization;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
    organization = await app.seed.organization({ slug: 'cedar-park' });
    await app.db.run(
      `INSERT INTO "PrayerTimingCriteria" ("Id", "OrganizationId", "Method", "JuristicMethodAsr", "Latitude", "Longitude", "TimezoneId", "DstObserved", "DstBegins", "DstEnds", "ZipCode", "MinutesAfterZawal", "MinutesAfterMaghrib", "KhutbahTimeMinutes", "UpdatedAtUtc")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      organization.id,
      criteria.method,
      criteria.juristicMethodAsr,
      criteria.latitude,
      criteria.longitude,
      criteria.timezoneId,
      1,
      null,
      null,
      '78613',
      criteria.minutesAfterZawal,
      criteria.minutesAfterMaghrib,
      20,
      '2026-01-02T03:04:05.000Z',
    );
  });

  describe('GET /api/v1/timings', () => {
    it('computes one day anonymously, by organization id (any case) or slug', async () => {
      const byId = await app.request('GET', `/api/v1/timings?orgId=${organization.id.toUpperCase()}&date=2026-08-19`);
      expect(byId.status).toBe(200);
      const body = (await byId.json()) as PrayerTimesDto;
      expect(Object.keys(body)).toEqual(['date', 'fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'sunset', 'isha']);
      expect(body).toEqual(expected('2026-08-19'));
      expect(body.date).toBe('2026-08-19');
      expect(body.fajr).toMatch(/^\d{2}:\d{2}:00$/);

      const bySlug = await app.request('GET', '/api/v1/timings?orgId=cedar-park&date=2026-08-19');
      expect(bySlug.status).toBe(200);
      expect(await bySlug.json()).toEqual(body);
    });

    it('is 400 for a missing or invalid date, before the organization is looked up', async () => {
      for (const [query, value] of [
        ['orgId=missing', ''],
        ['orgId=missing&date=2026-02-30', '2026-02-30'],
        ['date=tomorrow', 'tomorrow'],
      ]) {
        const response = await app.request('GET', `/api/v1/timings?${query}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          title: 'One or more validation errors occurred.',
          status: 400,
          errors: { date: [`The value '${value}' is not valid.`] },
        });
      }
    });

    it('is 400 without orgId', async () => {
      const response = await app.request('GET', '/api/v1/timings?date=2026-08-19');
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ status: 400, errors: { orgId: ['The orgId field is required.'] } });
    });

    it('is 404 for an unknown organization and for one without criteria', async () => {
      expect((await app.request('GET', `/api/v1/timings?orgId=${newId()}&date=2026-08-19`)).status).toBe(404);
      expect((await app.request('GET', '/api/v1/timings?orgId=no-such-slug&date=2026-08-19')).status).toBe(404);
      const bare = await app.seed.organization();
      const response = await app.request('GET', `/api/v1/timings?orgId=${bare.id}&date=2026-08-19`);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ title: 'Not Found', status: 404 });
    });
  });

  describe('GET /api/v1/timings/range', () => {
    it('returns one entry per day, both ends included', async () => {
      const response = await app.request('GET', `/api/v1/timings/range?orgId=${organization.id}&from=2026-02-27&to=2026-03-02`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'].map(expected));

      const single = await app.request('GET', '/api/v1/timings/range?orgId=cedar-park&from=2026-03-08&to=2026-03-08');
      expect(await single.json()).toEqual([expected('2026-03-08')]);
    });

    it('serves a whole year (367 days at most) from a single query', async () => {
      const response = await app.request('GET', `/api/v1/timings/range?orgId=${organization.id}&from=2028-01-01&to=2029-01-01`);
      expect(response.status).toBe(200);
      const days = (await response.json()) as PrayerTimesDto[];
      expect(days).toHaveLength(367);
      expect(days[0].date).toBe('2028-01-01');
      expect(days[59].date).toBe('2028-02-29');
      expect(days[366]).toEqual(expected('2029-01-01'));

      const tooLong = await app.request('GET', `/api/v1/timings/range?orgId=${organization.id}&from=2028-01-01&to=2029-01-02`);
      expect(tooLong.status).toBe(400);
      expect(await tooLong.text()).toBe('Date range must be no more than 367 days.');
    });

    it('is 400 for a reversed range or invalid dates, 404 for an unknown organization', async () => {
      const reversed = await app.request('GET', `/api/v1/timings/range?orgId=${organization.id}&from=2026-03-02&to=2026-03-01`);
      expect(reversed.status).toBe(400);
      expect(await reversed.text()).toBe('Invalid range');

      const noFrom = await app.request('GET', `/api/v1/timings/range?orgId=${organization.id}&to=2026-03-01`);
      expect(noFrom.status).toBe(400);
      expect(await noFrom.json()).toMatchObject({ errors: { from: ["The value '' is not valid."] } });

      const badTo = await app.request('GET', `/api/v1/timings/range?orgId=${organization.id}&from=2026-03-01&to=x`);
      expect(badTo.status).toBe(400);
      expect(await badTo.json()).toMatchObject({ errors: { to: ["The value 'x' is not valid."] } });

      expect((await app.request('GET', '/api/v1/timings/range?from=2026-03-01&to=2026-03-02')).status).toBe(400);
      expect((await app.request('GET', `/api/v1/timings/range?orgId=${newId()}&from=2026-03-01&to=2026-03-02`)).status).toBe(404);
    });
  });

  describe('GET /api/v1/timings/today', () => {
    it('computes today in the organization’s time zone', async () => {
      const before = todayInZone(criteria.timezoneId);
      const response = await app.request('GET', '/api/v1/timings/today?orgId=cedar-park');
      expect(response.status).toBe(200);
      const body = (await response.json()) as PrayerTimesDto;
      // The zone's date can roll over between the two readings.
      const candidates = [before, addDays(before, 1)].map((date) => toPrayerTimesDto(computePrayerTimes(criteria, date)));
      expect(candidates).toContainEqual(body);
    });

    it('is 400 without orgId and 404 without criteria', async () => {
      const missing = await app.request('GET', '/api/v1/timings/today');
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ errors: { orgId: ['The orgId field is required.'] } });
      expect((await app.request('GET', '/api/v1/timings/today?orgId=nobody')).status).toBe(404);
    });
  });

  it('applies the public rate limit: 60 requests per 5 seconds per client address', async () => {
    const path = `/api/v1/timings?orgId=${organization.id}&date=2026-08-19`;
    for (let i = 0; i < 60; i += 1) {
      expect((await app.request('GET', path)).status).toBe(200);
    }
    const limited = await app.request('GET', path);
    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe('');
    expect((await app.request('GET', path, { headers: { 'CF-Connecting-IP': '203.0.113.77' } })).status).toBe(200);
  });
});
