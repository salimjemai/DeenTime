import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latestEntriesPerSalah, salahOrder } from '../src/modules/iqama/iqama.mapper.js';
import { createTestApp, type SeededOrganization, type TestApp } from './support/test-app.js';

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

describe('iqama', () => {
  let app: TestApp;
  let token: string;
  let organization: SeededOrganization;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
    ({ token, organization } = await app.seed.signIn({ roles: ['Admin'] }));
  });

  function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { organizationId: organization.id, date: '2026-03-01', salah: 'Fajr', time: '05:45:00', ...overrides };
  }

  async function create(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const response = await app.request('POST', '/api/v1/iqama', { token, json: entry(overrides) });
    expect(response.status).toBe(201);
    return (await response.json()) as Record<string, unknown>;
  }

  async function expectEmpty(response: Response, status: number): Promise<void> {
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  }

  async function expectText(response: Response, status: number, text: string): Promise<void> {
    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(text);
  }

  it('requires a token on every endpoint and Admin/Editor on writes', async () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    await expectEmpty(await app.request('GET', `/api/v1/iqama?orgId=${organization.id}&year=2026`), 401);
    await expectEmpty(await app.request('GET', `/api/v1/iqama/current?orgId=${organization.id}`), 401);
    await expectEmpty(await app.request('PUT', '/api/v1/iqama/schedule', { json: {} }), 401);
    await expectEmpty(await app.request('POST', '/api/v1/iqama', { json: entry() }), 401);
    await expectEmpty(await app.request('PUT', `/api/v1/iqama/${id}`, { json: entry() }), 401);
    await expectEmpty(await app.request('DELETE', `/api/v1/iqama/${id}`), 401);

    const viewer = await app.seed.signIn({ roles: ['Viewer'] });
    const viewerEntry = entry({ organizationId: viewer.organization.id });
    // The role check precedes body validation.
    await expectEmpty(await app.request('PUT', '/api/v1/iqama/schedule', { token: viewer.token, json: {} }), 403);
    await expectEmpty(await app.request('POST', '/api/v1/iqama', { token: viewer.token, json: viewerEntry }), 403);
    await expectEmpty(await app.request('PUT', `/api/v1/iqama/${id}`, { token: viewer.token, json: viewerEntry }), 403);
    await expectEmpty(await app.request('DELETE', `/api/v1/iqama/${id}`, { token: viewer.token }), 403);
    // Reading only needs a session for the organization.
    expect((await app.request('GET', `/api/v1/iqama?orgId=${viewer.organization.id}&year=2026`, { token: viewer.token })).status).toBe(200);
  });

  it('creates an entry: 201, Location header and the entity JSON', async () => {
    const response = await app.request('POST', '/api/v1/iqama', { token, json: entry({ organizationId: organization.id.toUpperCase(), salah: 'fajr', time: '05:45', note: ' note ', offsetMinutes: 15 }) });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.headers.get('Location')).toBe(`/api/v1/iqama/${String(body.id)}`);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(Object.keys(body)).toEqual(['id', 'organizationId', 'date', 'salah', 'time', 'offsetMinutes', 'note', 'updatedAtUtc', 'organization']);
    expect(body).toMatchObject({ organizationId: organization.id, date: '2026-03-01', salah: 'Fajr', time: '05:45:00', offsetMinutes: 15, note: ' note ', organization: null });
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.updatedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const defaults = await create({ salah: 2, time: '13:30:00' });
    expect(defaults).toMatchObject({ salah: 'Dhuhr', offsetMinutes: null, note: null });
  });

  it('rejects duplicates, bad offsets, other organizations and invalid bodies on create', async () => {
    await create();
    await expectText(await app.request('POST', '/api/v1/iqama', { token, json: entry() }), 409, 'An Iqama entry already exists for that prayer and effective date.');
    await expectText(await app.request('POST', '/api/v1/iqama', { token, json: entry({ salah: 'Asr', offsetMinutes: 181 }) }), 400, 'Minutes after prayer start must be between 0 and 180.');
    await expectText(await app.request('POST', '/api/v1/iqama', { token, json: entry({ salah: 'Asr', offsetMinutes: -1 }) }), 400, 'Minutes after prayer start must be between 0 and 180.');

    const other = await app.seed.organization();
    await expectEmpty(await app.request('POST', '/api/v1/iqama', { token, json: entry({ organizationId: other.id }) }), 403);

    const invalid = await app.request('POST', '/api/v1/iqama', { token, json: { organizationId: EMPTY_GUID, date: '2026-02-30', salah: 'Brunch', time: '00:00:00' } });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    expect(await invalid.json()).toEqual({
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: {
        OrganizationId: ["'Organization Id' must not be empty."],
        Date: ['The value is not a valid date.'],
        Salah: ['The value is not a valid prayer.'],
        Time: ["'Time' must not be empty."],
      },
    });

    const malformed = await app.request('POST', '/api/v1/iqama', { token, json: { organizationId: 'nope', date: '2026-03-01', salah: 'Fajr', time: '25:00' } });
    expect(((await malformed.json()) as { errors: unknown }).errors).toEqual({ OrganizationId: ["'Organization Id' must not be empty."], Time: ['The value is not a valid time.'] });
  });

  it('lists a year ordered by date then salah, scoped to the organization', async () => {
    await create({ date: '2026-03-01', salah: 'Isha', time: '20:30:00' });
    await create({ date: '2026-03-01', salah: 'Fajr' });
    await create({ date: '2026-01-01', salah: 'Maghrib', time: '18:00:00' });
    await create({ date: '2025-12-31', salah: 'Fajr' });
    await create({ date: '2027-01-01', salah: 'Fajr' });

    const response = await app.request('GET', `/api/v1/iqama?orgId=${organization.id.toUpperCase()}&year=2026`, { token });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ date: string; salah: string }>;
    expect(body.map((item) => `${item.date} ${item.salah}`)).toEqual(['2026-01-01 Maghrib', '2026-03-01 Fajr', '2026-03-01 Isha']);

    // No year: backend-node queries year 0, which Date.UTC maps to 1900.
    expect(await (await app.request('GET', `/api/v1/iqama?orgId=${organization.id}`, { token })).json()).toEqual([]);

    const other = await app.seed.organization();
    await expectEmpty(await app.request('GET', `/api/v1/iqama?orgId=${other.id}&year=2026`, { token }), 403);
    await expectEmpty(await app.request('GET', '/api/v1/iqama?orgId=not-a-guid&year=2026', { token }), 403);
    await expectEmpty(await app.request('GET', '/api/v1/iqama?year=2026', { token }), 403);

    const superUser = await app.seed.signIn({ roles: ['SuperUser'] });
    const all = await app.request('GET', `/api/v1/iqama?orgId=${organization.id}&year=2026`, { token: superUser.token });
    expect(((await all.json()) as unknown[]).length).toBe(3);
    expect(await (await app.request('GET', '/api/v1/iqama?year=2026', { token: superUser.token })).json()).toEqual([]);
  });

  it('current returns the latest entry per prayer on or before the date, in prayer order', async () => {
    await create({ date: '2026-01-01', salah: 'Fajr', time: '06:00:00' });
    await create({ date: '2026-02-01', salah: 'Fajr', time: '05:50:00' });
    await create({ date: '2026-04-01', salah: 'Fajr', time: '05:10:00' });
    await create({ date: '2026-01-15', salah: 'Isha', time: '20:00:00' });
    await create({ date: '2026-01-10', salah: 'Khutbah', time: '13:00:00' });
    await create({ date: '2026-01-10', salah: 'Jumuah', time: '13:30:00' });

    const response = await app.request('GET', `/api/v1/iqama/current?orgId=${organization.id}&date=2026-03-01`, { token });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ date: string; salah: string; time: string }>;
    expect(body.map((item) => `${item.salah} ${item.date} ${item.time}`)).toEqual(['Fajr 2026-02-01 05:50:00', 'Jumuah 2026-01-10 13:30:00', 'Isha 2026-01-15 20:00:00', 'Khutbah 2026-01-10 13:00:00'].sort((a, b) => order(a) - order(b)));

    const early = await app.request('GET', `/api/v1/iqama/current?orgId=${organization.id}&date=2026-01-05`, { token });
    expect(((await early.json()) as Array<{ salah: string }>).map((item) => item.salah)).toEqual(['Fajr']);

    // A missing or invalid date means today (UTC): everything saved so far is in the past.
    const today = await app.request('GET', `/api/v1/iqama/current?orgId=${organization.id}&date=garbage`, { token });
    expect(((await today.json()) as Array<{ salah: string; date: string }>).find((item) => item.salah === 'Fajr')?.date).toBe('2026-04-01');

    await expectEmpty(await app.request('GET', `/api/v1/iqama/current?orgId=${(await app.seed.organization()).id}`, { token }), 403);
  });

  function order(line: string): number {
    return salahOrder(line.split(' ')[0] as Parameters<typeof salahOrder>[0]);
  }

  it('schedule upserts every entry for the effective date', async () => {
    const existing = await create({ date: '2026-05-01', salah: 'Fajr', time: '05:00:00', note: 'old' });
    const response = await app.request('PUT', '/api/v1/iqama/schedule', {
      token,
      json: {
        organizationId: organization.id,
        effectiveDate: '2026-05-01',
        entries: [
          { salah: 'Isha', time: '21:15', note: '   ' },
          { salah: 'Fajr', time: '05:20:00', note: ' after adhan ', offsetMinutes: 20 },
        ],
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(body.map((item) => item.salah)).toEqual(['Fajr', 'Isha']);
    expect(body[0]).toMatchObject({ id: existing.id, organizationId: organization.id, date: '2026-05-01', time: '05:20:00', note: 'after adhan', offsetMinutes: 20, organization: null });
    expect(body[1]).toMatchObject({ date: '2026-05-01', time: '21:15:00', note: null, offsetMinutes: null });
    expect(body[1].id).not.toBe(existing.id);

    const rows = await app.db.all<{ Salah: number; Time: string; Note: string | null }>('SELECT "Salah", "Time", "Note" FROM "IqamaEntries" ORDER BY "Salah"');
    expect(rows).toEqual([
      { Salah: 1, Time: '05:20:00', Note: 'after adhan' },
      { Salah: 5, Time: '21:15:00', Note: null },
    ]);
  });

  it('schedule rejects empty, oversized, duplicated and out-of-range input', async () => {
    const schedule = (entries: unknown, extra: Record<string, unknown> = {}) =>
      app.request('PUT', '/api/v1/iqama/schedule', { token, json: { organizationId: organization.id, effectiveDate: '2026-05-01', entries, ...extra } });

    await expectText(await schedule([]), 400, 'Add at least one Iqama time.');
    await expectText(await schedule(null), 400, 'Add at least one Iqama time.');
    const ten = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Jumuah', 'Khutbah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'].map((salah) => ({ salah, time: '10:00:00' }));
    await expectText(await schedule(ten), 400, 'A schedule can contain at most nine prayer entries.');
    await expectText(await schedule([{ salah: 'Fajr', time: '05:00' }, { salah: 1, time: '05:10' }]), 400, 'Each prayer can appear only once for an effective date.');
    await expectText(await schedule([{ salah: 'Fajr', time: '05:00', offsetMinutes: 200 }]), 400, 'Minutes after prayer start must be between 0 and 180.');

    const other = await app.seed.organization();
    await expectEmpty(await schedule([{ salah: 'Fajr', time: '05:00' }], { organizationId: other.id }), 403);

    const invalid = await schedule([{ salah: 'Nope', time: 'late' }], { effectiveDate: 'soon', organizationId: 'x' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: {
        OrganizationId: ["'Organization Id' must not be empty."],
        EffectiveDate: ['The value is not a valid date.'],
        'Entries[0].Salah': ['The value is not a valid prayer.'],
        'Entries[0].Time': ['The value is not a valid time.'],
      },
    });
    expect(await app.db.all('SELECT "Id" FROM "IqamaEntries"')).toEqual([]);
  });

  it('updates an entry in place', async () => {
    const created = await create();
    const response = await app.request('PUT', `/api/v1/iqama/${String(created.id).toUpperCase()}`, { token, json: entry({ date: '2026-03-02', salah: 'Asr', time: '16:30:00', note: 'n', offsetMinutes: 10 }) });
    await expectEmpty(response, 204);
    const list = (await (await app.request('GET', `/api/v1/iqama?orgId=${organization.id}&year=2026`, { token })).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, date: '2026-03-02', salah: 'Asr', time: '16:30:00', note: 'n', offsetMinutes: 10 });
  });

  it('update: 404 problem for unknown ids, 403 across organizations, 400 for bad input', async () => {
    const created = await create();
    for (const id of ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'not-a-guid']) {
      const missing = await app.request('PUT', `/api/v1/iqama/${id}`, { token, json: entry() });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await missing.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: 'Not Found', status: 404 });
    }

    // The body must name the entry's own organization.
    const other = await app.seed.organization();
    await expectEmpty(await app.request('PUT', `/api/v1/iqama/${String(created.id)}`, { token, json: entry({ organizationId: other.id }) }), 403);
    const stranger = await app.seed.signIn({ roles: ['Admin'] });
    await expectEmpty(await app.request('PUT', `/api/v1/iqama/${String(created.id)}`, { token: stranger.token, json: entry() }), 403);

    await expectText(await app.request('PUT', `/api/v1/iqama/${String(created.id)}`, { token, json: entry({ offsetMinutes: 500 }) }), 400, 'Minutes after prayer start must be between 0 and 180.');
    // Validation precedes the lookup.
    expect((await app.request('PUT', '/api/v1/iqama/not-a-guid', { token, json: {} })).status).toBe(400);
  });

  it('deletes an entry', async () => {
    const created = await create();
    const stranger = await app.seed.signIn({ roles: ['Editor'] });
    await expectEmpty(await app.request('DELETE', `/api/v1/iqama/${String(created.id)}`, { token: stranger.token }), 403);
    await expectEmpty(await app.request('DELETE', `/api/v1/iqama/${String(created.id)}`, { token }), 204);
    expect((await app.request('DELETE', `/api/v1/iqama/${String(created.id)}`, { token })).status).toBe(404);
    expect((await app.request('DELETE', '/api/v1/iqama/not-a-guid', { token })).status).toBe(404);
    expect(await app.db.all('SELECT "Id" FROM "IqamaEntries"')).toEqual([]);
  });

  it('matches routes case-insensitively', async () => {
    await create();
    const response = await app.request('GET', `/API/V1/Iqama/Current?orgId=${organization.id}&date=2026-12-31`, { token });
    expect(response.status).toBe(200);
    expect(((await response.json()) as unknown[]).length).toBe(1);
  });
});

describe('iqama mapper', () => {
  it('latestEntriesPerSalah keeps the newest row per prayer', () => {
    const rows = [
      { Salah: 1, Date: '2026-02-01', UpdatedAtUtc: '2026-01-01T00:00:00.000Z', tag: 'b' },
      { Salah: 1, Date: '2026-01-01', UpdatedAtUtc: '2026-03-01T00:00:00.000Z', tag: 'a' },
      { Salah: 2, Date: '2026-01-01', UpdatedAtUtc: '2026-01-01T00:00:00.000Z', tag: 'c' },
      { Salah: 2, Date: '2026-01-01', UpdatedAtUtc: '2026-01-02T00:00:00.000Z', tag: 'd' },
    ];
    expect(latestEntriesPerSalah(rows).map((row) => row.tag)).toEqual(['d', 'b']);
    expect(salahOrder('Khutbah')).toBe(99);
    expect(salahOrder('Jumuah2nd')).toBe(6);
  });
});
