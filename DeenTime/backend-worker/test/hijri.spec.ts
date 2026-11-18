import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/core/db.js';
import { parseDateOnly } from '../src/core/json.js';
import { generateHijriMonthMaps } from '../src/domain/hijri.js';
import { createTestApp, type SeededOrganization, type TestApp } from './support/test-app.js';

interface HijriJson {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  hijriDayOnFirst: number;
  hijriMonthOnFirst: number;
  hijriYearOnFirst: number;
  locked: boolean;
  updatedAtUtc: string;
}

function generated(from: string, to: string) {
  return generateHijriMonthMaps(parseDateOnly(`${from}-01`) as Date, parseDateOnly(`${to}-01`) as Date);
}

describe('hijri', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
  });

  async function seedMap(organization: SeededOrganization, columns: Partial<Record<'Year' | 'Month' | 'HijriDayOnFirst' | 'HijriMonthOnFirst' | 'HijriYearOnFirst' | 'Locked', number>> = {}): Promise<string> {
    const id = newId();
    const row = { Year: 2030, Month: 1, HijriDayOnFirst: 9, HijriMonthOnFirst: 9, HijriYearOnFirst: 1499, Locked: 0, ...columns };
    await app.db.run(
      'INSERT INTO "HijriMonthMaps" ("Id", "OrganizationId", "Year", "Month", "HijriDayOnFirst", "HijriMonthOnFirst", "HijriYearOnFirst", "Locked", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      organization.id,
      row.Year,
      row.Month,
      row.HijriDayOnFirst,
      row.HijriMonthOnFirst,
      row.HijriYearOnFirst,
      row.Locked,
      '2026-01-02T03:04:05.000Z',
    );
    return id;
  }

  async function count(organization: SeededOrganization): Promise<number> {
    return (await app.db.first<{ Total: number }>('SELECT COUNT(*) AS "Total" FROM "HijriMonthMaps" WHERE "OrganizationId" = ?', organization.id))?.Total ?? 0;
  }

  describe('GET /api/v1/hijri/:orgId', () => {
    it('generates and stores the missing months, then returns the stored rows', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Viewer'] });
      const response = await app.request('GET', `/api/v1/hijri/${organization.id.toUpperCase()}?from=2030-01&to=2030-03`, { token });
      expect(response.status).toBe(200);
      const maps = (await response.json()) as HijriJson[];
      expect(maps).toHaveLength(3);
      expect(Object.keys(maps[0])).toEqual(['id', 'organizationId', 'year', 'month', 'hijriDayOnFirst', 'hijriMonthOnFirst', 'hijriYearOnFirst', 'locked', 'updatedAtUtc']);
      expect(maps.map(({ year, month, hijriDayOnFirst, hijriMonthOnFirst, hijriYearOnFirst, locked }) => ({ year, month, hijriDayOnFirst, hijriMonthOnFirst, hijriYearOnFirst, locked }))).toEqual(generated('2030-01', '2030-03'));
      expect(maps[0].organizationId).toBe(organization.id);
      expect(maps[0].locked).toBe(false);
      expect(maps[0].updatedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(await count(organization)).toBe(3);

      const again = await app.request('GET', `/api/v1/hijri/${organization.id}?from=2030-01&to=2030-03`, { token });
      expect(await again.json()).toEqual(maps);
      expect(await count(organization)).toBe(3);
    });

    it('keeps stored months, repairs unlocked placeholders and leaves locked ones alone', async () => {
      const { token, organization } = await app.seed.signIn();
      const kept = await seedMap(organization, { Year: 2030, Month: 1, HijriDayOnFirst: 3, HijriMonthOnFirst: 7, HijriYearOnFirst: 1450 });
      const placeholder = await seedMap(organization, { Year: 2030, Month: 2, HijriDayOnFirst: 5, HijriMonthOnFirst: 1, HijriYearOnFirst: 1 });
      const lockedPlaceholder = await seedMap(organization, { Year: 2030, Month: 3, HijriDayOnFirst: 5, HijriMonthOnFirst: 0, HijriYearOnFirst: 1, Locked: 1 });
      await seedMap(organization, { Year: 2031, Month: 1 });

      const response = await app.request('GET', `/api/v1/hijri/${organization.id}?from=2030-01&to=2030-04`, { token });
      expect(response.status).toBe(200);
      const maps = (await response.json()) as HijriJson[];
      const expected = generated('2030-01', '2030-04');
      expect(maps.map((map) => map.month)).toEqual([1, 2, 3, 4]);
      expect(maps[0]).toMatchObject({ id: kept, hijriDayOnFirst: 3, hijriMonthOnFirst: 7, hijriYearOnFirst: 1450, updatedAtUtc: '2026-01-02T03:04:05.000Z' });
      expect(maps[1]).toMatchObject({ id: placeholder, ...expected[1] });
      expect(maps[1].updatedAtUtc).not.toBe('2026-01-02T03:04:05.000Z');
      expect(maps[2]).toMatchObject({ id: lockedPlaceholder, hijriDayOnFirst: 5, hijriMonthOnFirst: 0, hijriYearOnFirst: 1, locked: true });
      expect(maps[3]).toMatchObject(expected[3]);

      const stored = await app.db.first<{ HijriMonthOnFirst: number; HijriYearOnFirst: number }>('SELECT "HijriMonthOnFirst", "HijriYearOnFirst" FROM "HijriMonthMaps" WHERE "Id" = ?', placeholder);
      expect(stored).toEqual({ HijriMonthOnFirst: expected[1].hijriMonthOnFirst, HijriYearOnFirst: expected[1].hijriYearOnFirst });
      expect(await count(organization)).toBe(5);
    });

    it('accepts 25 months and rejects a longer, reversed or malformed range', async () => {
      const { token, organization } = await app.seed.signIn();
      const widest = await app.request('GET', `/api/v1/hijri/${organization.id}?from=2030-01&to=2032-01`, { token });
      expect(widest.status).toBe(200);
      expect((await widest.json()) as unknown[]).toHaveLength(25);

      for (const query of ['from=2030-01&to=2032-02', 'from=2030-02&to=2030-01']) {
        const response = await app.request('GET', `/api/v1/hijri/${organization.id}?${query}`, { token });
        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Date range must be no more than 24 months.');
      }
      for (const query of ['', 'from=2030-01', 'from=2030-13&to=2030-12', 'from=2030&to=2031']) {
        const response = await app.request('GET', `/api/v1/hijri/${organization.id}?${query}`, { token });
        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Invalid YYYY-MM range');
      }
    });

    it('is 401 without a token, 403 for another organization, 404 for a malformed id', async () => {
      const { token } = await app.seed.signIn();
      const other = await app.seed.organization();
      expect((await app.request('GET', `/api/v1/hijri/${other.id}?from=2030-01&to=2030-01`)).status).toBe(401);
      const forbidden = await app.request('GET', `/api/v1/hijri/${other.id}?from=2030-01&to=2030-01`, { token });
      expect(forbidden.status).toBe(403);
      expect(await forbidden.text()).toBe('');
      expect(await count(other)).toBe(0);
      expect((await app.request('GET', '/api/v1/hijri/not-a-guid?from=2030-01&to=2030-01', { token })).status).toBe(404);
    });

    it('lets a super user read any organization', async () => {
      const { user, organization } = await app.seed.signIn({ roles: ['SuperUser', 'Admin'] });
      const token = await app.token(user, organization.id, ['SuperUser', 'Admin']);
      const other = await app.seed.organization();
      const response = await app.request('GET', `/api/v1/hijri/${other.id}?from=2030-01&to=2030-01`, { token });
      expect(response.status).toBe(200);
      expect(((await response.json()) as HijriJson[])[0].organizationId).toBe(other.id);
    });
  });

  describe('POST /api/v1/hijri', () => {
    it('creates a record: 201 with a Location header', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Editor'] });
      const response = await app.request('POST', '/api/v1/hijri', {
        token,
        json: { organizationId: organization.id.toUpperCase(), year: 2031, month: 5, hijriDayOnFirst: 12, hijriMonthOnFirst: 2, hijriYearOnFirst: 1453, locked: true },
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as HijriJson;
      expect(response.headers.get('location')).toBe(`/api/v1/hijri/${body.id}`);
      expect(body).toMatchObject({ organizationId: organization.id, year: 2031, month: 5, hijriDayOnFirst: 12, hijriMonthOnFirst: 2, hijriYearOnFirst: 1453, locked: true });
      const stored = await app.db.first<Record<string, unknown>>('SELECT * FROM "HijriMonthMaps" WHERE "Id" = ?', body.id);
      expect(stored).toMatchObject({ OrganizationId: organization.id, Year: 2031, Month: 5, HijriDayOnFirst: 12, HijriMonthOnFirst: 2, HijriYearOnFirst: 1453, Locked: 1, UpdatedAtUtc: body.updatedAtUtc });
    });

    it('defaults the Hijri month and year to 1 and the other fields to their zero values', async () => {
      const { token, organization } = await app.seed.signIn();
      const response = await app.request('POST', '/api/v1/hijri', { token, json: { organizationId: organization.id } });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ year: 0, month: 0, hijriDayOnFirst: 0, hijriMonthOnFirst: 1, hijriYearOnFirst: 1, locked: false });
    });

    it('is 401 without a token, 403 for a viewer, another organization or no organization id', async () => {
      const { token, organization } = await app.seed.signIn();
      const other = await app.seed.organization();
      const body = { organizationId: organization.id, year: 2031, month: 5, hijriDayOnFirst: 1 };
      expect((await app.request('POST', '/api/v1/hijri', { json: body })).status).toBe(401);
      expect((await app.request('POST', '/api/v1/hijri', { token, json: { ...body, organizationId: other.id } })).status).toBe(403);
      expect((await app.request('POST', '/api/v1/hijri', { token, json: { year: 2031, month: 5 } })).status).toBe(403);
      expect((await app.request('POST', '/api/v1/hijri', { token, json: { ...body, organizationId: 'nope' } })).status).toBe(403);

      const viewer = await app.seed.signIn({ roles: ['Viewer'] });
      expect((await app.request('POST', '/api/v1/hijri', { token: viewer.token, json: { ...body, organizationId: viewer.organization.id } })).status).toBe(403);
      expect(await count(organization)).toBe(0);
    });

    it('is 400 for a body of the wrong type', async () => {
      const { token, organization } = await app.seed.signIn();
      const response = await app.request('POST', '/api/v1/hijri', { token, json: { organizationId: organization.id, year: 'soon', locked: 'yes' } });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ title: 'One or more validation errors occurred.', status: 400 });
    });
  });

  describe('PUT /api/v1/hijri/:id', () => {
    it('updates the record and keeps the Hijri month and year when they are omitted', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Editor'] });
      const id = await seedMap(organization);
      const response = await app.request('PUT', `/api/v1/hijri/${id.toUpperCase()}`, { token, json: { organizationId: organization.id.toUpperCase(), year: 2030, month: 2, hijriDayOnFirst: 28, locked: true } });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      const stored = await app.db.first<Record<string, unknown>>('SELECT * FROM "HijriMonthMaps" WHERE "Id" = ?', id);
      expect(stored).toMatchObject({ Year: 2030, Month: 2, HijriDayOnFirst: 28, HijriMonthOnFirst: 9, HijriYearOnFirst: 1499, Locked: 1 });
      expect(stored?.UpdatedAtUtc).not.toBe('2026-01-02T03:04:05.000Z');

      const full = await app.request('PUT', `/api/v1/hijri/${id}`, { token, json: { organizationId: organization.id, year: 2030, month: 2, hijriDayOnFirst: 1, hijriMonthOnFirst: 10, hijriYearOnFirst: 1451, locked: false } });
      expect(full.status).toBe(204);
      expect(await app.db.first('SELECT "HijriMonthOnFirst", "HijriYearOnFirst", "Locked" FROM "HijriMonthMaps" WHERE "Id" = ?', id)).toEqual({ HijriMonthOnFirst: 10, HijriYearOnFirst: 1451, Locked: 0 });
    });

    it('is 404 for an unknown or malformed id, 403 for another organization’s record, 400 when moved', async () => {
      const { token, organization } = await app.seed.signIn();
      const other = await app.seed.organization();
      const own = await seedMap(organization);
      const foreign = await seedMap(other);
      const body = { organizationId: organization.id, year: 2030, month: 1, hijriDayOnFirst: 1 };

      expect((await app.request('PUT', `/api/v1/hijri/${newId()}`, { token, json: body })).status).toBe(404);
      expect((await app.request('PUT', '/api/v1/hijri/not-a-guid', { token, json: body })).status).toBe(404);
      expect((await app.request('PUT', `/api/v1/hijri/${foreign}`, { token, json: body })).status).toBe(403);

      const moved = await app.request('PUT', `/api/v1/hijri/${own}`, { token, json: { ...body, organizationId: other.id } });
      expect(moved.status).toBe(400);
      expect(await moved.text()).toBe('A Hijri record cannot be moved to another masjid.');
      const missing = await app.request('PUT', `/api/v1/hijri/${own}`, { token, json: { year: 2030, month: 1 } });
      expect(missing.status).toBe(400);

      expect((await app.request('PUT', `/api/v1/hijri/${own}`, { json: body })).status).toBe(401);
      const viewer = await app.token({ id: newId(), email: 'viewer@masjid.test' }, organization.id, ['Viewer']);
      expect((await app.request('PUT', `/api/v1/hijri/${own}`, { token: viewer, json: body })).status).toBe(403);
      expect(await app.db.first('SELECT "HijriDayOnFirst" FROM "HijriMonthMaps" WHERE "Id" = ?', own)).toEqual({ HijriDayOnFirst: 9 });
    });
  });

  describe('POST /api/v1/hijri/regenerate/:orgId', () => {
    it('replaces the unlocked months of the range and preserves locked ones', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Editor'] });
      const edited = await seedMap(organization, { Year: 2030, Month: 1, HijriDayOnFirst: 30 });
      const locked = await seedMap(organization, { Year: 2030, Month: 2, HijriDayOnFirst: 30, Locked: 1 });
      const outside = await seedMap(organization, { Year: 2030, Month: 7, HijriDayOnFirst: 30 });

      const response = await app.request('POST', `/api/v1/hijri/regenerate/${organization.id}?from=2030-01&to=2030-06`, { token });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ regenerated: 5, preservedLocked: 1 });

      const rows = await app.db.all<{ Id: string; Month: number; HijriDayOnFirst: number; HijriMonthOnFirst: number; HijriYearOnFirst: number; Locked: number }>(
        'SELECT "Id", "Month", "HijriDayOnFirst", "HijriMonthOnFirst", "HijriYearOnFirst", "Locked" FROM "HijriMonthMaps" WHERE "OrganizationId" = ? ORDER BY "Year", "Month"',
        organization.id,
      );
      expect(rows.map((row) => row.Month)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      const expected = generated('2030-01', '2030-06');
      expect(rows[0].Id).not.toBe(edited);
      expect(rows[0]).toMatchObject({ HijriDayOnFirst: expected[0].hijriDayOnFirst, HijriMonthOnFirst: expected[0].hijriMonthOnFirst, HijriYearOnFirst: expected[0].hijriYearOnFirst, Locked: 0 });
      expect(rows[1]).toMatchObject({ Id: locked, HijriDayOnFirst: 30, Locked: 1 });
      expect(rows[6]).toMatchObject({ Id: outside, HijriDayOnFirst: 30 });
    });

    it('regenerates 25 months in one request', async () => {
      const { token, organization } = await app.seed.signIn();
      const response = await app.request('POST', `/api/v1/hijri/regenerate/${organization.id}?from=2030-01&to=2032-01`, { token });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ regenerated: 25, preservedLocked: 0 });
      expect(await count(organization)).toBe(25);
    });

    it('is 400 for a bad range, 401 / 403 / 404 like the other routes', async () => {
      const { token, organization } = await app.seed.signIn();
      const other = await app.seed.organization();
      const invalid = await app.request('POST', `/api/v1/hijri/regenerate/${organization.id}?from=2030-01`, { token });
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).toBe('Invalid range');
      const tooLong = await app.request('POST', `/api/v1/hijri/regenerate/${organization.id}?from=2030-01&to=2032-02`, { token });
      expect(tooLong.status).toBe(400);
      expect(await tooLong.text()).toBe('Date range must be no more than 24 months.');

      expect((await app.request('POST', `/api/v1/hijri/regenerate/${organization.id}?from=2030-01&to=2030-02`)).status).toBe(401);
      expect((await app.request('POST', `/api/v1/hijri/regenerate/${other.id}?from=2030-01&to=2030-02`, { token })).status).toBe(403);
      expect((await app.request('POST', '/api/v1/hijri/regenerate/not-a-guid?from=2030-01&to=2030-02', { token })).status).toBe(404);
      const viewer = await app.seed.signIn({ roles: ['Viewer'] });
      expect((await app.request('POST', `/api/v1/hijri/regenerate/${viewer.organization.id}?from=2030-01&to=2030-02`, { token: viewer.token })).status).toBe(403);
      expect(await count(organization)).toBe(0);
    });
  });
});
