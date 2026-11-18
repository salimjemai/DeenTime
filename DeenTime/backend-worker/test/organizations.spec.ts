import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { servicesFor } from '../src/core/context.js';
import { newId, now } from '../src/core/db.js';
import { resetPostalCodeService } from '../src/integrations/postal-code.js';
import { createTestApp, type SeededOrganization, type TestApp } from './support/test-app.js';

const zippopotam = {
  'post code': '78613',
  country: 'United States',
  'country abbreviation': 'US',
  places: [{ 'place name': 'Cedar Park', longitude: '-97.8203', state: 'Texas', 'state abbreviation': 'TX', latitude: '30.5052' }],
};

const criteriaBody = {
  zipCode: '78613',
  method: 'ISNA',
  juristicMethodAsr: 'Other',
  latitude: 30.5052,
  longitude: 30.5052,
  timezoneId: 'America/Chicago',
  dstObserved: true,
  minutesAfterZawal: 5,
  minutesAfterMaghrib: 1,
  khutbahTimeMinutes: 20,
};

describe('organizations', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
    resetPostalCodeService(servicesFor(app.env).config);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetch(handler: (url: string) => Response): { calls: string[] } {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return handler(url);
    });
    return { calls };
  }

  async function superUserToken(): Promise<string> {
    const { user, organization } = await app.seed.signIn({ roles: ['SuperUser', 'Admin'] });
    return app.token(user, organization.id, ['SuperUser', 'Admin']);
  }

  async function seedCriteria(organization: SeededOrganization, columns: Record<string, string | number | null> = {}): Promise<string> {
    const id = newId();
    const row: Record<string, string | number | null> = {
      Id: id,
      OrganizationId: organization.id,
      Method: 'ISNA',
      JuristicMethodAsr: 'Other',
      Latitude: 30.5052,
      Longitude: -97.8203,
      TimezoneId: 'America/Chicago',
      DstObserved: 1,
      DstBegins: null,
      DstEnds: null,
      ZipCode: '78613',
      MinutesAfterZawal: 5,
      MinutesAfterMaghrib: 1,
      KhutbahTimeMinutes: 20,
      UpdatedAtUtc: '2026-01-02T03:04:05.000Z',
      ...columns,
    };
    const names = Object.keys(row);
    await app.db.run(`INSERT INTO "PrayerTimingCriteria" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, ...names.map((n) => row[n]));
    return id;
  }

  async function seedIqama(organization: SeededOrganization, salah: number, date: string): Promise<void> {
    await app.db.run(
      'INSERT INTO "IqamaEntries" ("Id", "OrganizationId", "Date", "Salah", "Time", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      organization.id,
      date,
      salah,
      '13:30:00',
      now(),
    );
  }

  describe('GET /api/v1/orgs', () => {
    it('is 401 without a token', async () => {
      const response = await app.request('GET', '/api/v1/orgs');
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('');
    });

    it('lists only the caller’s organization, as the entity JSON', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Admin'] });
      await app.seed.organization({ name: 'Another Masjid' });
      const response = await app.request('GET', '/api/v1/orgs?page=1', { token });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      const body = (await response.json()) as { items: Record<string, unknown>[]; page: number; pageSize: number; total: number };
      expect(body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(Object.keys(body)).toEqual(['items', 'page', 'pageSize', 'total']);
      expect(body.items).toHaveLength(1);
      expect(Object.keys(body.items[0])).toEqual([
        'id',
        'slug',
        'name',
        'normalizedName',
        'normalizedWebsiteHost',
        'addressFingerprint',
        'masjidIdentityKey',
        'adminUserId',
        'addressLine',
        'city',
        'state',
        'zipCode',
        'phone',
        'websiteUrl',
        'email',
        'socialUrl',
        'criteria',
        'design',
        'updatedAtUtc',
      ]);
      expect(body.items[0]).toMatchObject({ id: organization.id, slug: organization.slug, name: organization.name, criteria: null, design: null, addressLine: null });
      expect(body.items[0].updatedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('does not let a search widen a member’s scope', async () => {
      const { token } = await app.seed.signIn({ roles: ['Admin'] });
      await app.seed.organization({ name: 'Zeta Masjid' });
      const body = (await (await app.request('GET', '/api/v1/orgs?search=zeta', { token })).json()) as { total: number; items: unknown[] };
      expect(body.total).toBe(0);
      expect(body.items).toEqual([]);
    });

    it('is 403 when the token has no organization id', async () => {
      const user = await app.seed.user();
      const response = await app.request('GET', '/api/v1/orgs', { token: await app.token(user, 'not-a-guid', ['Admin']) });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('');
    });

    it('pages 20 at a time ordered by name for a super user', async () => {
      const token = await superUserToken();
      await app.db.run('DELETE FROM "Organizations"');
      for (let i = 1; i <= 25; i += 1) await app.seed.organization({ name: `Masjid ${String(i).padStart(2, '0')}` });

      const first = (await (await app.request('GET', '/api/v1/orgs', { token })).json()) as { items: { name: string }[]; page: number; pageSize: number; total: number };
      expect(first).toMatchObject({ page: 1, pageSize: 20, total: 25 });
      expect(first.items.map((item) => item.name)).toEqual(Array.from({ length: 20 }, (_, i) => `Masjid ${String(i + 1).padStart(2, '0')}`));

      const second = (await (await app.request('GET', '/api/v1/orgs?page=2', { token })).json()) as { items: { name: string }[]; page: number; total: number };
      expect(second).toMatchObject({ page: 2, total: 25 });
      expect(second.items.map((item) => item.name)).toEqual(['Masjid 21', 'Masjid 22', 'Masjid 23', 'Masjid 24', 'Masjid 25']);

      const beyond = (await (await app.request('GET', '/api/v1/orgs?page=9', { token })).json()) as { items: unknown[]; page: number; total: number };
      expect(beyond).toMatchObject({ page: 9, total: 25, items: [] });

      for (const page of ['abc', '0', '-3', '']) {
        const body = (await (await app.request('GET', `/api/v1/orgs?page=${page}`, { token })).json()) as { page: number; items: unknown[] };
        expect(body.page, page).toBe(1);
        expect(body.items).toHaveLength(20);
      }
    });

    it('searches the name case-insensitively and treats wildcards literally', async () => {
      const token = await superUserToken();
      await app.db.run('DELETE FROM "Organizations"');
      await app.seed.organization({ name: 'Cedar Park Masjid' });
      await app.seed.organization({ name: 'cedar hills islamic center' });
      await app.seed.organization({ name: 'Austin 100% Masjid' });
      await app.seed.organization({ name: 'Round_Rock Masjid' });

      const names = async (search: string): Promise<string[]> => {
        const response = await app.request('GET', `/api/v1/orgs?search=${encodeURIComponent(search)}`, { token });
        expect(response.status).toBe(200);
        return ((await response.json()) as { items: { name: string }[] }).items.map((item) => item.name);
      };
      expect(await names('CEDAR')).toEqual(['cedar hills islamic center', 'Cedar Park Masjid']);
      expect(await names('park mas')).toEqual(['Cedar Park Masjid']);
      expect(await names('%')).toEqual(['Austin 100% Masjid']);
      expect(await names('_')).toEqual(['Round_Rock Masjid']);
      expect(await names('nothing')).toEqual([]);
      expect(await names('   ')).toHaveLength(4);
    });
  });

  describe('GET /api/v1/orgs/:idOrSlug', () => {
    it('returns the organization by id (any case) or slug, with its criteria', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Viewer'] });
      const criteriaId = await seedCriteria(organization, { DstBegins: '2026-03-08', DstEnds: '2026-11-01' });

      for (const key of [organization.id, organization.id.toUpperCase(), organization.slug]) {
        const response = await app.request('GET', `/api/v1/orgs/${key}`, { token });
        expect(response.status, key).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ id: organization.id, slug: organization.slug, design: null });
        expect(body.criteria).toEqual({
          id: criteriaId,
          organizationId: organization.id,
          method: 'ISNA',
          juristicMethodAsr: 'Other',
          latitude: 30.5052,
          longitude: -97.8203,
          timezoneId: 'America/Chicago',
          dstObserved: true,
          dstBegins: '2026-03-08',
          dstEnds: '2026-11-01',
          zipCode: '78613',
          minutesAfterZawal: 5,
          minutesAfterMaghrib: 1,
          khutbahTimeMinutes: 20,
          updatedAtUtc: '2026-01-02T03:04:05.000Z',
          organization: null,
        });
      }
    });

    it('returns criteria: null when none is saved', async () => {
      const { token, organization } = await app.seed.signIn();
      const body = (await (await app.request('GET', `/api/v1/orgs/${organization.slug}`, { token })).json()) as Record<string, unknown>;
      expect(body.criteria).toBeNull();
    });

    it('is 403 for another organization, 404 for an unknown one, and open to a super user', async () => {
      const { token } = await app.seed.signIn();
      const other = await app.seed.organization();
      for (const key of [other.id, other.slug]) {
        const response = await app.request('GET', `/api/v1/orgs/${key}`, { token });
        expect(response.status).toBe(403);
        expect(await response.text()).toBe('');
      }
      for (const key of [newId(), 'no-such-slug', other.slug.toUpperCase()]) {
        const response = await app.request('GET', `/api/v1/orgs/${key}`, { token });
        expect(response.status, key).toBe(404);
        expect(await response.json()).toMatchObject({ title: 'Not Found', status: 404 });
      }
      expect((await app.request('GET', `/api/v1/orgs/${other.slug}`, { token: await superUserToken() })).status).toBe(200);
      expect((await app.request('GET', `/api/v1/orgs/${other.id}`)).status).toBe(401);
    });
  });

  describe('PUT /api/v1/orgs/:id', () => {
    const update = { name: 'Mosque <East> & Community', addressLine: '1 Main St', city: 'Austin', state: 'TX', zipCode: '78701', phone: '', websiteUrl: '', email: '', socialUrl: '' };

    it('saves the profile and normalizes the name when there is no website', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Admin'] });
      const response = await app.request('PUT', `/api/v1/orgs/${organization.id.toUpperCase()}`, { token, json: update });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');

      const saved = (await (await app.request('GET', `/api/v1/orgs/${organization.id}`, { token })).json()) as Record<string, unknown>;
      expect(saved).toMatchObject({
        name: 'Mosque <East> & Community',
        normalizedName: 'MOSQUE <EAST> & COMMUNITY',
        addressLine: '1 Main St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        phone: '',
        websiteUrl: '',
        email: '',
        socialUrl: '',
        normalizedWebsiteHost: null,
        addressFingerprint: null,
        masjidIdentityKey: null,
      });
    });

    it('stores the registration identity when website and address are complete', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['owner'] });
      const response = await app.request('PUT', `/api/v1/orgs/${organization.id}`, { token, json: { ...update, name: '  Cedar   Park Masjid ', websiteUrl: 'WWW.CedarPark.example/about' } });
      expect(response.status).toBe(204);
      const saved = (await (await app.request('GET', `/api/v1/orgs/${organization.id}`, { token })).json()) as Record<string, unknown>;
      expect(saved).toMatchObject({ name: '  Cedar   Park Masjid ', normalizedName: 'CEDAR PARK MASJID', websiteUrl: 'https://cedarpark.example', normalizedWebsiteHost: 'cedarpark.example' });
      expect(saved.addressFingerprint).toMatch(/^[0-9A-F]{64}$/);
      expect(saved.masjidIdentityKey).toMatch(/^[0-9A-F]{64}$/);

      // A later update without a website keeps the stored website and identity.
      expect((await app.request('PUT', `/api/v1/orgs/${organization.id}`, { token, json: { name: 'Renamed' } })).status).toBe(204);
      const renamed = (await (await app.request('GET', `/api/v1/orgs/${organization.id}`, { token })).json()) as Record<string, unknown>;
      expect(renamed).toMatchObject({ name: 'Renamed', normalizedName: 'RENAMED', websiteUrl: 'https://cedarpark.example', normalizedWebsiteHost: 'cedarpark.example', addressLine: null, phone: null });
      expect(renamed.addressFingerprint).toBe(saved.addressFingerprint);
    });

    it('is 409 when the website, address or name + ZIP belongs to another masjid', async () => {
      const first = await app.seed.signIn({ roles: ['Admin'] });
      const second = await app.seed.signIn({ roles: ['Admin'] });
      const full = { name: 'First Masjid', addressLine: '1 Main St', city: 'Austin', state: 'TX', zipCode: '78701', websiteUrl: 'https://first.example' };
      expect((await app.request('PUT', `/api/v1/orgs/${first.organization.id}`, { token: first.token, json: full })).status).toBe(204);
      // Saving the same values again does not conflict with itself.
      expect((await app.request('PUT', `/api/v1/orgs/${first.organization.id}`, { token: first.token, json: full })).status).toBe(204);

      const attempts = [
        { ...full, name: 'Second Masjid', addressLine: '2 Other St' }, // same website host
        { ...full, name: 'Second Masjid', websiteUrl: 'https://second.example', addressLine: ' 1  main st ' }, // same address
        { ...full, name: 'first  masjid', websiteUrl: 'https://second.example', addressLine: '2 Other St' }, // same name + ZIP
      ];
      for (const json of attempts) {
        const response = await app.request('PUT', `/api/v1/orgs/${second.organization.id}`, { token: second.token, json });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ code: 'masjid_already_registered', message: 'This masjid website or address belongs to another registration.' });
      }
      const untouched = (await (await app.request('GET', `/api/v1/orgs/${second.organization.id}`, { token: second.token })).json()) as Record<string, unknown>;
      expect(untouched.name).toBe(second.organization.name);

      const distinct = { ...full, name: 'Second Masjid', websiteUrl: 'https://second.example', addressLine: '2 Other St' };
      expect((await app.request('PUT', `/api/v1/orgs/${second.organization.id}`, { token: second.token, json: distinct })).status).toBe(204);
    });

    it('rejects an invalid website with a validation problem', async () => {
      const { token, organization } = await app.seed.signIn();
      const response = await app.request('PUT', `/api/v1/orgs/${organization.id}`, { token, json: { ...update, websiteUrl: 'ftp://files.example' } });
      expect(response.status).toBe(400);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { WebsiteUrl: ['Enter a valid masjid website address.'] },
      });
      expect(typeof body.traceId).toBe('string');
    });

    it('requires the name, before looking at the id', async () => {
      const { token } = await app.seed.signIn();
      const response = await app.request('PUT', '/api/v1/orgs/not-a-guid', { token, json: { city: 'Austin' } });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ title: 'One or more validation errors occurred.', status: 400, errors: { Name: ['The Name field is required.'] } });
    });

    it('enforces the Admin policy, organization scope and existence', async () => {
      const editor = await app.seed.signIn({ roles: ['Editor'] });
      const denied = await app.request('PUT', `/api/v1/orgs/${editor.organization.id}`, { token: editor.token, json: update });
      expect(denied.status).toBe(403);
      expect(await denied.text()).toBe('');

      const admin = await app.seed.signIn({ roles: ['Admin'] });
      expect((await app.request('PUT', `/api/v1/orgs/${editor.organization.id}`, { token: admin.token, json: update })).status).toBe(403);
      expect((await app.request('PUT', '/api/v1/orgs/not-a-guid', { token: admin.token, json: update })).status).toBe(404);
      expect((await app.request('PUT', `/api/v1/orgs/${admin.organization.id}`, { json: update })).status).toBe(401);

      const superToken = await superUserToken();
      expect((await app.request('PUT', `/api/v1/orgs/${newId()}`, { token: superToken, json: update })).status).toBe(404);
      expect((await app.request('PUT', `/api/v1/orgs/${editor.organization.id}`, { token: superToken, json: update })).status).toBe(204);
    });
  });

  describe('criteria', () => {
    it('GET is 404 until criteria are saved, 403 for another organization', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Viewer'] });
      const other = await app.seed.organization();
      const missing = await app.request('GET', `/api/v1/orgs/${organization.id}/criteria`, { token });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ title: 'Not Found', status: 404 });
      expect((await app.request('GET', `/api/v1/orgs/${other.id}/criteria`, { token })).status).toBe(403);
      expect((await app.request('GET', `/api/v1/orgs/${organization.slug}/criteria`, { token })).status).toBe(404);
      expect((await app.request('GET', `/api/v1/orgs/${organization.id}/criteria`)).status).toBe(401);
    });

    it('a U.S. ZIP is authoritative when prayer criteria are saved', async () => {
      const token = await superUserToken();
      const organization = await app.seed.organization();
      const stub = stubFetch(() => Response.json(zippopotam));
      const update = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: { organizationId: organization.id, ...criteriaBody, zipCode: '78613-1234' } });
      expect(update.status).toBe(204);
      expect(await update.text()).toBe('');
      expect(stub.calls).toEqual(['https://api.zippopotam.us/us/78613']);

      const saved = await app.request('GET', `/api/v1/orgs/${organization.id.toUpperCase()}/criteria`, { token });
      expect(saved.status).toBe(200);
      const body = (await saved.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        organizationId: organization.id,
        method: 'ISNA',
        juristicMethodAsr: 'Other',
        latitude: 30.5052,
        longitude: -97.8203,
        timezoneId: 'America/Chicago',
        dstObserved: true,
        dstBegins: null,
        dstEnds: null,
        zipCode: '78613',
        minutesAfterZawal: 5,
        minutesAfterMaghrib: 1,
        khutbahTimeMinutes: 20,
        organization: null,
      });
      expect(Object.keys(body)).toEqual([
        'id',
        'organizationId',
        'method',
        'juristicMethodAsr',
        'latitude',
        'longitude',
        'timezoneId',
        'dstObserved',
        'dstBegins',
        'dstEnds',
        'zipCode',
        'minutesAfterZawal',
        'minutesAfterMaghrib',
        'khutbahTimeMinutes',
        'updatedAtUtc',
        'organization',
      ]);
    });

    it('keeps the submitted coordinates for a non-U.S. postal code, applies defaults, and updates in place', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Editor'] });
      const stub = stubFetch(() => Response.json(zippopotam));
      const first = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: { latitude: '51.5', longitude: -0.12, zipCode: 'SW1A 1AA', timezoneId: 'Europe/London', dstBegins: '2026-03-29', dstEnds: '2026-10-25' } });
      expect(first.status).toBe(204);
      expect(stub.calls).toEqual([]);
      const created = (await (await app.request('GET', `/api/v1/orgs/${organization.id}/criteria`, { token })).json()) as Record<string, unknown>;
      expect(created).toMatchObject({
        method: 'ISNA',
        juristicMethodAsr: 'Other',
        latitude: 51.5,
        longitude: -0.12,
        timezoneId: 'Europe/London',
        dstObserved: true,
        dstBegins: '2026-03-29',
        dstEnds: '2026-10-25',
        zipCode: 'SW1A 1AA',
        minutesAfterZawal: 5,
        minutesAfterMaghrib: 1,
        khutbahTimeMinutes: 20,
      });

      const second = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: { latitude: 10, longitude: 20, method: 'mwl', juristicMethodAsr: 'Hanafi', dstObserved: false, minutesAfterZawal: 0, khutbahTimeMinutes: 180 } });
      expect(second.status).toBe(204);
      const updated = (await (await app.request('GET', `/api/v1/orgs/${organization.id}/criteria`, { token })).json()) as Record<string, unknown>;
      expect(updated).toMatchObject({ id: created.id, method: 'mwl', juristicMethodAsr: 'Hanafi', latitude: 10, longitude: 20, timezoneId: 'America/Chicago', dstObserved: false, dstBegins: null, dstEnds: null, zipCode: '', minutesAfterZawal: 0, khutbahTimeMinutes: 180 });
      expect((await app.db.first<{ Total: number }>('SELECT COUNT(*) AS "Total" FROM "PrayerTimingCriteria"'))?.Total).toBe(1);
    });

    it('is 400 when the U.S. ZIP is unknown and 503 when the lookup is down; nothing is saved', async () => {
      const { token, organization } = await app.seed.signIn();
      stubFetch(() => new Response(null, { status: 404 }));
      const unknown = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: { ...criteriaBody, zipCode: '99999' } });
      expect(unknown.status).toBe(400);
      const unknownBody = (await unknown.json()) as Record<string, unknown>;
      expect(unknownBody).toMatchObject({
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { ZipCode: ['The U.S. ZIP code could not be found.'] },
      });
      expect(typeof unknownBody.traceId).toBe('string');

      vi.restoreAllMocks();
      stubFetch(() => new Response('down', { status: 502 }));
      const down = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: criteriaBody });
      expect(down.status).toBe(503);
      expect(await down.json()).toMatchObject({
        type: 'https://tools.ietf.org/html/rfc9110#section-15.6.4',
        title: 'Postal-code lookup is temporarily unavailable.',
        status: 503,
        detail: 'Prayer criteria were not saved because the location could not be verified.',
      });

      vi.restoreAllMocks();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
      expect((await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: criteriaBody })).status).toBe(503);
      expect((await app.request('GET', `/api/v1/orgs/${organization.id}/criteria`, { token })).status).toBe(404);
    });

    it('reports the validator messages', async () => {
      const { token, organization } = await app.seed.signIn();
      const empty = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: {} });
      expect(empty.status).toBe(400);
      expect(await empty.json()).toEqual({
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { Latitude: ['The Latitude field is required.'], Longitude: ['The Longitude field is required.'] },
      });

      const invalid = await app.request('PUT', '/api/v1/orgs/not-a-guid/criteria', {
        token,
        json: {
          method: 'Moon',
          juristicMethodAsr: 'Shafi',
          latitude: 91,
          longitude: -181,
          timezoneId: 'Mars/Olympus',
          dstBegins: '2026-11-01',
          dstEnds: '2026-03-08',
          zipCode: 'x'.repeat(33),
          minutesAfterZawal: 121,
          minutesAfterMaghrib: -1,
          khutbahTimeMinutes: 181,
        },
      });
      expect(invalid.status).toBe(400);
      expect(((await invalid.json()) as { errors: Record<string, string[]> }).errors).toEqual({
        Method: ['Select a supported prayer calculation method.'],
        JuristicMethodAsr: ['Asr method must be Standard or Hanafi.'],
        Latitude: ["'Latitude' must be between -90 and 90."],
        Longitude: ["'Longitude' must be between -180 and 180."],
        TimezoneId: ['Select a valid IANA timezone.'],
        DstEnds: ['DST end must be after DST start.'],
        ZipCode: ["The length of 'Zip Code' must be 32 characters or fewer."],
        MinutesAfterZawal: ["'Minutes After Zawal' must be between 0 and 120."],
        MinutesAfterMaghrib: ["'Minutes After Maghrib' must be between 0 and 120."],
        KhutbahTimeMinutes: ["'Khutbah Time Minutes' must be between 0 and 180."],
      });

      const dst = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: { latitude: 1, longitude: 1, dstBegins: '2026-11-01', dstEnds: '2026-03-08' } });
      expect(((await dst.json()) as { errors: Record<string, string[]> }).errors).toEqual({ DstEnds: ['DST end must be after DST start.'] });

      const badDate = await app.request('PUT', `/api/v1/orgs/${organization.id}/criteria`, { token, json: { latitude: 1, longitude: 1, dstBegins: '03/08/2026', timezoneId: ' ' } });
      expect(((await badDate.json()) as { errors: Record<string, string[]> }).errors).toEqual({ TimezoneId: ["'Timezone Id' must not be empty."], DstBegins: ['The value is not a valid date.'] });
    });

    it('PUT and DELETE need the Admin or Editor role and the caller’s organization', async () => {
      const viewer = await app.seed.signIn({ roles: ['Viewer'] });
      const json = { latitude: 1, longitude: 2 };
      expect((await app.request('PUT', `/api/v1/orgs/${viewer.organization.id}/criteria`, { token: viewer.token, json })).status).toBe(403);
      expect((await app.request('DELETE', `/api/v1/orgs/${viewer.organization.id}/criteria`, { token: viewer.token })).status).toBe(403);

      const editor = await app.seed.signIn({ roles: ['Editor'] });
      expect((await app.request('PUT', `/api/v1/orgs/${viewer.organization.id}/criteria`, { token: editor.token, json })).status).toBe(403);
      expect((await app.request('DELETE', `/api/v1/orgs/${viewer.organization.id}/criteria`, { token: editor.token })).status).toBe(403);
      expect((await app.request('PUT', '/api/v1/orgs/not-a-guid/criteria', { token: editor.token, json })).status).toBe(404);
      expect((await app.request('DELETE', '/api/v1/orgs/not-a-guid/criteria', { token: editor.token })).status).toBe(404);
      expect((await app.request('PUT', `/api/v1/orgs/${editor.organization.id}/criteria`, { json })).status).toBe(401);
      expect((await app.request('DELETE', `/api/v1/orgs/${editor.organization.id}/criteria`)).status).toBe(401);
    });

    it('DELETE removes the criteria and is 204 even when there is none', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Editor'] });
      await seedCriteria(organization);
      const other = await app.seed.organization();
      await seedCriteria(other);

      const response = await app.request('DELETE', `/api/v1/orgs/${organization.id.toUpperCase()}/criteria`, { token });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect((await app.request('GET', `/api/v1/orgs/${organization.id}/criteria`, { token })).status).toBe(404);
      expect((await app.request('DELETE', `/api/v1/orgs/${organization.id}/criteria`, { token })).status).toBe(204);
      expect((await app.db.first<{ Total: number }>('SELECT COUNT(*) AS "Total" FROM "PrayerTimingCriteria"'))?.Total).toBe(1);
    });
  });

  describe('GET /api/v1/orgs/:id/readiness', () => {
    const today = new Date().toISOString().slice(0, 10);

    it('reports nothing ready for a new organization', async () => {
      const { token, organization } = await app.seed.signIn({ roles: ['Viewer'] });
      const response = await app.request('GET', `/api/v1/orgs/${organization.id}/readiness`, { token });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        readyToPublish: false,
        checks: {
          criteria: false,
          dailyIqama: { Fajr: false, Dhuhr: false, Asr: false, Maghrib: false, Isha: false },
          jumuah: false,
          design: false,
          publicPreview: false,
        },
        jumuahCount: 0,
        effectiveDate: today,
      });
      expect(JSON.stringify(body)).toMatch(/^\{"readyToPublish":false,"checks":\{"criteria":false,"dailyIqama":\{"Fajr"/);
    });

    it('is ready with criteria, the five daily iqamas, a Jumuah and a header image', async () => {
      const { token, organization } = await app.seed.signIn();
      await seedCriteria(organization);
      for (const salah of [1, 2, 3, 4]) await seedIqama(organization, salah, '2026-01-01');
      await seedIqama(organization, 1, '2025-06-01'); // an older Fajr entry does not count twice
      await seedIqama(organization, 5, '2999-01-01'); // Isha only starts in the future
      await seedIqama(organization, 6, today);
      await seedIqama(organization, 8, '2026-01-01');
      await seedIqama(organization, 7, '2026-01-01'); // Khutbah is not a Jumuah
      await app.db.run('INSERT INTO "DesignSettings" ("Id", "OrganizationId", "HeaderImageUrl", "Theme", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?)', newId(), organization.id, '   ', 'default', now());

      const partial = (await (await app.request('GET', `/api/v1/orgs/${organization.id.toUpperCase()}/readiness`, { token })).json()) as Record<string, unknown>;
      expect(partial).toEqual({
        readyToPublish: false,
        checks: {
          criteria: true,
          dailyIqama: { Fajr: true, Dhuhr: true, Asr: true, Maghrib: true, Isha: false },
          jumuah: true,
          design: false,
          publicPreview: true,
        },
        jumuahCount: 2,
        effectiveDate: today,
      });

      await seedIqama(organization, 5, '2026-01-01');
      await app.db.run('UPDATE "DesignSettings" SET "HeaderImageUrl" = ? WHERE "OrganizationId" = ?', '/uploads/header.png', organization.id);
      const ready = (await (await app.request('GET', `/api/v1/orgs/${organization.id}/readiness`, { token })).json()) as { readyToPublish: boolean; checks: { design: boolean } };
      expect(ready.readyToPublish).toBe(true);
      expect(ready.checks.design).toBe(true);
    });

    it('is 401 / 403 / 404 like the other organization routes', async () => {
      const { token, organization } = await app.seed.signIn();
      const other = await app.seed.organization();
      expect((await app.request('GET', `/api/v1/orgs/${organization.id}/readiness`)).status).toBe(401);
      expect((await app.request('GET', `/api/v1/orgs/${other.id}/readiness`, { token })).status).toBe(403);
      expect((await app.request('GET', '/api/v1/orgs/not-a-guid/readiness', { token })).status).toBe(404);
      expect((await app.request('GET', `/api/v1/orgs/${newId()}/readiness`, { token: await superUserToken() })).status).toBe(404);
    });
  });
});
