import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId, toJsonArray } from '../src/core/db.js';
import { salahToDb } from '../src/core/json.js';
import { RATE_LIMIT_POLICIES } from '../src/core/rate-limit.js';
import { expectValidPdf, pdfTexts } from './pdf-helpers.js';
import { createTestApp, TEST_PUBLIC_BASE_URL, type SeededOrganization, type TestApp } from './support/test-app.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '11111111-2222-4333-8444-555555555555';
const TV_DEFAULTS = { showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 160, autoRefreshSeconds: 30 };

describe('publish', () => {
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

  async function seedCriteria(organizationId = organization.id): Promise<void> {
    await app.db.run(
      `INSERT INTO "PrayerTimingCriteria" ("Id", "OrganizationId", "Method", "JuristicMethodAsr", "Latitude", "Longitude", "TimezoneId", "DstObserved", "DstBegins", "DstEnds", "ZipCode", "MinutesAfterZawal", "MinutesAfterMaghrib", "KhutbahTimeMinutes", "UpdatedAtUtc")
       VALUES (?, ?, 'ISNA', 'Other', 30.5119418, -97.8177601, 'America/Chicago', 1, NULL, NULL, '78717', 5, 1, 30, '2026-01-01T00:00:00.000Z')`,
      newId(),
      organizationId,
    );
  }

  async function seedArtifact(year: number, month: number, createdAtUtc: string, organizationId = organization.id): Promise<string> {
    const id = newId();
    await app.db.run(
      'INSERT INTO "PublishArtifacts" ("Id", "OrganizationId", "Year", "Month", "Size", "Orientation", "StorageUrl", "CreatedAtUtc") VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
      id,
      organizationId,
      year,
      month,
      `https://cdn.deentime.test/pdfs/${id}.pdf?sig=a%20b`,
      createdAtUtc,
    );
    return id;
  }

  /** A second organization with its own Admin, to check cross-organization access. */
  async function otherOrganization(): Promise<{ organization: SeededOrganization; token: string }> {
    return app.seed.signIn({ roles: ['Admin'] });
  }

  async function superUserToken(): Promise<string> {
    return app.token(await app.seed.user(), organization.id, ['SuperUser', 'Admin']);
  }

  async function expectEmpty(response: Response, status: number): Promise<void> {
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  }

  /** notFound(): the ApiController 404 ProblemDetails. */
  async function expectNotFound(response: Response): Promise<void> {
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    expect(await response.json()).toMatchObject({ title: 'Not Found', status: 404 });
  }

  it('requires a session on every route', async () => {
    for (const [method, path] of [
      ['GET', `/api/v1/publish/embed-code/${organization.id}`],
      ['GET', `/api/v1/publish/tv-config/${organization.id}`],
      ['PUT', `/api/v1/publish/tv-config/${organization.id}`],
      ['POST', '/api/v1/publish/pdf/generate'],
      ['POST', '/api/v1/publish/pdf/ramadan'],
      ['GET', `/api/v1/publish/artifacts?orgId=${organization.id}&year=2026`],
      ['GET', `/api/v1/publish/pdf/${UNKNOWN_ID}`],
    ]) {
      await expectEmpty(await app.request(method, path, method === 'GET' ? {} : { json: {} }), 401);
    }
  });

  it('lets only Admin and Editor change the TV configuration or generate PDFs', async () => {
    const viewer = await app.token(await app.seed.user(), organization.id, ['Viewer']);
    await expectEmpty(await app.request('PUT', `/api/v1/publish/tv-config/${organization.id}`, { token: viewer, json: {} }), 403);
    await expectEmpty(await app.request('POST', '/api/v1/publish/pdf/generate', { token: viewer, json: { orgId: organization.id, year: 2026, month: 2 } }), 403);
    await expectEmpty(await app.request('POST', '/api/v1/publish/pdf/ramadan', { token: viewer, json: { orgId: organization.id, year: 2026 } }), 403);
    expect((await app.request('GET', `/api/v1/publish/tv-config/${organization.id}`, { token: viewer })).status).toBe(200);

    const editor = await app.token(await app.seed.user(), organization.id, ['Editor']);
    expect((await app.request('PUT', `/api/v1/publish/tv-config/${organization.id}`, { token: editor, json: {} })).status).toBe(200);
  });

  describe('GET /api/v1/publish/embed-code/:orgId', () => {
    it('returns the embed URLs and markup at the configured public origin', async () => {
      const response = await app.request('GET', `/api/v1/publish/embed-code/${organization.id.toUpperCase()}`, { token });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(body.widgetUrl).toBe(`${TEST_PUBLIC_BASE_URL}/w/${organization.slug}`);
      expect(body.combinedWidgetUrl).toBe(body.widgetUrl);
      expect(body.dailyWidgetUrl).toBe(`${TEST_PUBLIC_BASE_URL}/w/${organization.slug}/daily`);
      expect(body.jumuahWidgetUrl).toBe(`${TEST_PUBLIC_BASE_URL}/w/${organization.slug}/jumuah`);
      expect(body.compactWidgetUrl).toBe(`${TEST_PUBLIC_BASE_URL}/w2/${organization.slug}`);
      expect(body.tvUrl).toBe(`${TEST_PUBLIC_BASE_URL}/tv/${organization.slug}`);
      expect(body.iframe).toContain(`src="${TEST_PUBLIC_BASE_URL}/w/${organization.slug}"`);
      expect(body.iframe).toContain(`title="MasjidHub &#183; ${organization.name} prayer times"`);
      expect(body.iframe).toContain('data-iqamatime-auto-height');
      expect(body.iframe).toContain(`${TEST_PUBLIC_BASE_URL}/iqamatime-embed.js`);
      expect(body.dailyIframe).toContain(`/w/${organization.slug}/daily`);
      expect(body.jumuahIframe).toContain(`/w/${organization.slug}/jumuah`);
    });

    it('uses the first publicOrigin query value when given', async () => {
      const response = await app.request('GET', `/api/v1/publish/embed-code/${organization.id}?publicOrigin=https%3A%2F%2Fiqamatime.example&publicOrigin=https%3A%2F%2Fother.example`, { token });
      const body = (await response.json()) as Json;
      expect(body.iframe).toContain('src="https://iqamatime.example/w/');
      expect(body.iframe).not.toContain('public.deentime.test');
      expect(body.dailyWidgetUrl.startsWith('https://iqamatime.example/w/')).toBe(true);
      expect(body.iframe).toContain('https://iqamatime.example/iqamatime-embed.js');
    });

    it('fails with the 500 problem for an origin that is not a public https origin', async () => {
      for (const origin of ['http%3A%2F%2Fiqamatime.example', 'https%3A%2F%2Flocalhost', 'not-a-url']) {
        const response = await app.request('GET', `/api/v1/publish/embed-code/${organization.id}?publicOrigin=${origin}`, { token });
        expect(response.status, origin).toBe(500);
        expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      }
    });

    it('answers 404 for a malformed or unknown organization id and 403 for another organization', async () => {
      await expectNotFound(await app.request('GET', '/api/v1/publish/embed-code/not-a-guid', { token }));
      await expectEmpty(await app.request('GET', `/api/v1/publish/embed-code/${UNKNOWN_ID}`, { token }), 403);
      await expectNotFound(await app.request('GET', `/api/v1/publish/embed-code/${UNKNOWN_ID}`, { token: await superUserToken() }));
      const other = await otherOrganization();
      await expectEmpty(await app.request('GET', `/api/v1/publish/embed-code/${other.organization.id}`, { token }), 403);
      expect((await app.request('GET', `/api/v1/publish/embed-code/${other.organization.id}`, { token: await superUserToken() })).status).toBe(200);
    });
  });

  describe('TV configuration', () => {
    it('returns the defaults with a fresh id until a configuration is saved', async () => {
      const response = await app.request('GET', `/api/v1/publish/tv-config/${organization.id}`, { token });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(Object.keys(body)).toEqual(['id', 'organizationId', 'showSeconds', 'showHijri', 'accentColor', 'clockFontScale', 'autoRefreshSeconds']);
      expect(body).toEqual({ id: expect.stringMatching(GUID), organizationId: organization.id, ...TV_DEFAULTS });
      expect(await app.db.first('SELECT "Id" FROM "TvDisplayConfigs"')).toBeNull();
    });

    it('saves, clamps and updates in place, and the public display shows it', async () => {
      const path = `/api/v1/publish/tv-config/${organization.id}`;
      const created = await app.request('PUT', path, { token, json: { id: '', organizationId: organization.id, showSeconds: true, showHijri: false, accentColor: '#112233', clockFontScale: 250, autoRefreshSeconds: 5 } });
      expect(created.status).toBe(200);
      const first = (await created.json()) as Json;
      expect(first).toEqual({ id: expect.stringMatching(GUID), organizationId: organization.id, showSeconds: true, showHijri: false, accentColor: '#112233', clockFontScale: 200, autoRefreshSeconds: 15 });

      const updated = await app.request('PUT', path, { token, json: { showSeconds: false, showHijri: true, accentColor: '  ', clockFontScale: 10, autoRefreshSeconds: 99999 } });
      expect(await updated.json()).toEqual({ id: first.id, organizationId: organization.id, showSeconds: false, showHijri: true, accentColor: '#00AEEF', clockFontScale: 80, autoRefreshSeconds: 3600 });
      expect(await app.db.all('SELECT "Id" FROM "TvDisplayConfigs"')).toEqual([{ Id: first.id }]);

      // Missing members take the request record's defaults.
      const defaults = await app.request('PUT', path, { token, json: {} });
      expect(await defaults.json()).toEqual({ id: first.id, organizationId: organization.id, showSeconds: false, showHijri: false, accentColor: '#00AEEF', clockFontScale: 160, autoRefreshSeconds: 30 });
      expect(await (await app.request('GET', path, { token })).json()).toMatchObject({ id: first.id, clockFontScale: 160 });

      const display = (await (await app.request('GET', `/public/display/${organization.slug}?layout=tv`)).json()) as Json;
      expect(display.tvConfig).toEqual({ showSeconds: false, showHijri: false, accentColor: '#00AEEF', clockFontScale: 160, autoRefreshSeconds: 30 });
    });

    it('rejects an unbindable body, a malformed id and another organization', async () => {
      const invalid = await app.request('PUT', `/api/v1/publish/tv-config/${organization.id}`, { token, json: { showSeconds: 'yes', clockFontScale: 'big' } });
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      const problem = (await invalid.json()) as Json;
      expect(problem).toMatchObject({ title: 'One or more validation errors occurred.', status: 400 });
      expect(Object.keys(problem.errors).sort()).toEqual(['ClockFontScale', 'ShowSeconds']);

      await expectNotFound(await app.request('GET', '/api/v1/publish/tv-config/nope', { token }));
      await expectNotFound(await app.request('PUT', '/api/v1/publish/tv-config/nope', { token, json: {} }));
      const other = await otherOrganization();
      await expectEmpty(await app.request('GET', `/api/v1/publish/tv-config/${other.organization.id}`, { token }), 403);
      await expectEmpty(await app.request('PUT', `/api/v1/publish/tv-config/${other.organization.id}`, { token, json: {} }), 403);
      expect(await app.db.first('SELECT "Id" FROM "TvDisplayConfigs"')).toBeNull();
    });
  });

  describe('POST /api/v1/publish/pdf/generate', () => {
    it('renders the monthly schedule, stores it and records the artifact', async () => {
      await seedCriteria();
      await app.db.run('UPDATE "Organizations" SET "Name" = ?, "AddressLine" = ?, "City" = ?, "State" = ?, "ZipCode" = ?, "Phone" = ? WHERE "Id" = ?', 'Masjid Al-Noor (Test)', '1 Main St', 'Austin', 'TX', '78717', '555-0100', organization.id);
      await app.db.run(
        `INSERT INTO "DesignSettings" ("Id", "OrganizationId", "IqamaHeadings", "FooterHtml", "Theme", "UpdatedAtUtc") VALUES (?, ?, ?, ?, 'default', '2026-01-01T00:00:00.000Z')`,
        newId(),
        organization.id,
        toJsonArray(['FAJR', 'IQM', 'SUNRISE', 'start', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'Starts']),
        '<p>&copy; 2026 <b>Al-Noor</b></p>',
      );
      await app.db.run(
        `INSERT INTO "IqamaEntries" ("Id", "OrganizationId", "Date", "Salah", "Time", "Note", "UpdatedAtUtc", "OffsetMinutes") VALUES (?, ?, '2026-01-01', ${salahToDb('Fajr')}, '06:15:00', NULL, '2026-01-01T00:00:00.000Z', NULL)`,
        newId(),
        organization.id,
      );
      await app.db.run(
        `INSERT INTO "HijriMonthMaps" ("Id", "OrganizationId", "Year", "Month", "HijriDayOnFirst", "Locked", "UpdatedAtUtc", "HijriMonthOnFirst", "HijriYearOnFirst") VALUES (?, ?, 2026, 2, 5, 0, '2026-01-01T00:00:00.000Z', 8, 1447)`,
        newId(),
        organization.id,
      );

      const response = await app.request('POST', '/api/v1/publish/pdf/generate', { token, json: { orgId: organization.id.toUpperCase(), year: 2026, month: '2', size: 'tabloid', orientation: 1 } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(Object.keys(body)).toEqual(['id', 'organizationId', 'year', 'month', 'size', 'orientation', 'storageUrl', 'createdAtUtc']);
      expect(body).toMatchObject({ id: expect.stringMatching(GUID), organizationId: organization.id, year: 2026, month: 2, size: 'Tabloid', orientation: 'Landscape' });
      expect(body.storageUrl).toMatch(new RegExp(`^https://masjidhub\\.test/uploads/artifacts/${organization.id}/2026-2-[0-9a-f-]{36}\\.pdf$`));
      expect(body.createdAtUtc).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(await app.db.all('SELECT "Id", "Year", "Month", "Size", "Orientation", "StorageUrl" FROM "PublishArtifacts"')).toEqual([
        { Id: body.id, Year: 2026, Month: 2, Size: 1, Orientation: 1, StorageUrl: body.storageUrl },
      ]);

      const download = await app.request('GET', new URL(body.storageUrl).pathname);
      expect(download.status).toBe(200);
      expect(download.headers.get('Content-Type')).toBe('application/pdf');
      const bytes = new Uint8Array(await download.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
      expect(expectValidPdf(bytes)).toBe(1);
      const texts = pdfTexts(bytes);
      expect(texts.slice(0, 5)).toEqual(['Adhan & Iqama Timings', '(February 2026)', 'Masjid Al-Noor (Test)', '1 Main St Austin TX 78717', 'Phone: 555-0100']);
      expect(texts[5]).toBe('\xa9 2026  Al-Noor');
      expect(texts.slice(6, 19)).toEqual(['DATE', 'DAY', 'HIJRI', 'FAJR', 'IQM', 'SUNRISE', 'ADHAN', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'ADHAN']);
      // 02/01 with the anchored Hijri date, then Fajr and its fixed Iqama.
      expect(texts.slice(19, 22)).toEqual(['02/01', 'Sun', '5/8/1447']);
      expect(texts[23]).toBe('6:15');
      expect(texts.filter((text) => /^02\/\d\d$/.test(text))).toHaveLength(28);

      const redirect = await app.request('GET', `/api/v1/publish/pdf/${body.id}`, { token });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get('Location')).toBe(body.storageUrl);
      const display = (await (await app.request('GET', `/public/display/${organization.slug}`)).json()) as Json;
      expect(display.monthlyPdfUrl === null || display.monthlyPdfUrl === body.storageUrl).toBe(true);
    });

    it('defaults to Letter portrait', async () => {
      await seedCriteria();
      const response = await app.request('POST', '/api/v1/publish/pdf/generate', { token, json: { orgId: organization.id, year: 2026, month: 12 } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(body).toMatchObject({ size: 'Letter', orientation: 'Portrait', month: 12 });
      const bytes = new Uint8Array(await (await app.request('GET', new URL(body.storageUrl).pathname)).arrayBuffer());
      expect(expectValidPdf(bytes)).toBe(1);
      expect(pdfTexts(bytes)).toContain('(December 2026)');
    });

    it('validates the request before checking the organization', async () => {
      for (const [json, keys] of [
        [{}, ['Month', 'OrgId', 'Year']],
        [{ orgId: organization.id, year: 1999, month: 13 }, ['Month', 'Year']],
        [{ orgId: 'nope', year: 2026, month: 2 }, ['OrgId']],
        [{ orgId: organization.id, year: 2026, month: 2, size: 'A4', orientation: 'Sideways' }, ['Orientation', 'Size']],
      ] as [Json, string[]][]) {
        const response = await app.request('POST', '/api/v1/publish/pdf/generate', { token, json });
        expect(response.status, JSON.stringify(json)).toBe(400);
        const problem = (await response.json()) as Json;
        expect(problem).toMatchObject({ title: 'One or more validation errors occurred.', status: 400 });
        expect(Object.keys(problem.errors).sort()).toEqual(keys);
      }
      const range = (await (await app.request('POST', '/api/v1/publish/pdf/generate', { token, json: { orgId: organization.id, year: 1999, month: 13 } })).json()) as Json;
      expect(range.errors.Year).toEqual(["'Year' must be between 2000 and 2100. You entered 1999."]);
      expect(range.errors.Month).toEqual(["'Month' must be between 1 and 12. You entered 13."]);
      expect(await app.db.first('SELECT "Id" FROM "PublishArtifacts"')).toBeNull();
    });

    it('answers 403 for another organization and the 500 problem without criteria or organization', async () => {
      const other = await otherOrganization();
      await seedCriteria(other.organization.id);
      await expectEmpty(await app.request('POST', '/api/v1/publish/pdf/generate', { token, json: { orgId: other.organization.id, year: 2026, month: 2 } }), 403);

      const withoutCriteria = await app.request('POST', '/api/v1/publish/pdf/generate', { token, json: { orgId: organization.id, year: 2026, month: 2 } });
      expect(withoutCriteria.status).toBe(500);
      expect(withoutCriteria.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await withoutCriteria.json()).toMatchObject({ status: 500, title: 'The request could not be completed.' });

      const unknown = await app.request('POST', '/api/v1/publish/pdf/generate', { token: await superUserToken(), json: { orgId: UNKNOWN_ID, year: 2026, month: 2 } });
      expect(unknown.status).toBe(500);
      expect(await app.db.first('SELECT "Id" FROM "PublishArtifacts"')).toBeNull();
    });

    it('applies the "expensive" rate limit per user', async () => {
      await seedCriteria();
      const json = { orgId: organization.id, year: 2026, month: 2 };
      for (let index = 0; index < RATE_LIMIT_POLICIES.expensive.permitLimit; index++) {
        expect((await app.request('POST', '/api/v1/publish/pdf/generate', { token, json })).status).toBe(200);
      }
      await expectEmpty(await app.request('POST', '/api/v1/publish/pdf/generate', { token, json }), 429);
      // The Ramadan route shares the policy; another user has their own window.
      await expectEmpty(await app.request('POST', '/api/v1/publish/pdf/ramadan', { token, json: { orgId: organization.id, year: 2026 } }), 429);
      const editor = await app.token(await app.seed.user(), organization.id, ['Editor']);
      expect((await app.request('POST', '/api/v1/publish/pdf/generate', { token: editor, json })).status).toBe(200);
    });
  });

  describe('POST /api/v1/publish/pdf/ramadan', () => {
    it('renders the Ramadan schedule of the year and records it with month 0', async () => {
      await seedCriteria();
      const response = await app.request('POST', '/api/v1/publish/pdf/ramadan', { token, json: { orgId: organization.id, year: 2026, size: 'Letter', orientation: 'Landscape' } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(body).toMatchObject({ organizationId: organization.id, year: 2026, month: 0, size: 'Letter', orientation: 'Landscape' });
      expect(body.storageUrl).toMatch(new RegExp(`^https://masjidhub\\.test/uploads/artifacts/${organization.id}/ramadan-2026-Letter-[0-9a-f-]{36}\\.pdf$`));

      const bytes = new Uint8Array(await (await app.request('GET', new URL(body.storageUrl).pathname)).arrayBuffer());
      expect(expectValidPdf(bytes)).toBe(1);
      const texts = pdfTexts(bytes);
      expect(texts[1]).toBe('(Ramadan 1447 / 2026)');
      // Without a design the default headings are used and there is no footer.
      expect(texts.slice(3, 16)).toEqual(['DATE', 'DAY', 'HIJRI', 'FAJR', 'IQM*', 'SUNRISE', 'DUHUR', 'IQM*', 'ASR', 'IQM*', 'SUNSET', 'ISHA', 'IQM*']);
      const hijriDates = texts.filter((text) => /^\d+\/9\/1447$/.test(text));
      expect(hijriDates.length).toBeGreaterThanOrEqual(29);
      expect(hijriDates[0]).toBe('1/9/1447');
      expect(texts.some((text) => /^\d+\/(8|10)\/1447$/.test(text))).toBe(false);
    });

    it('follows the organization month maps and fails with the 500 problem when the year has no Ramadan', async () => {
      await seedCriteria();
      for (let month = 1; month <= 12; month++) {
        await app.db.run(
          `INSERT INTO "HijriMonthMaps" ("Id", "OrganizationId", "Year", "Month", "HijriDayOnFirst", "Locked", "UpdatedAtUtc", "HijriMonthOnFirst", "HijriYearOnFirst") VALUES (?, ?, 2026, ?, 1, 0, '2026-01-01T00:00:00.000Z', 1, 1447)`,
          newId(),
          organization.id,
          month,
        );
      }
      const response = await app.request('POST', '/api/v1/publish/pdf/ramadan', { token, json: { orgId: organization.id, year: 2026 } });
      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await app.db.first('SELECT "Id" FROM "PublishArtifacts"')).toBeNull();
    });

    it('answers 403 without an organization id or for another organization, 400 for an unbindable body', async () => {
      await expectEmpty(await app.request('POST', '/api/v1/publish/pdf/ramadan', { token, json: { year: 2026 } }), 403);
      const other = await otherOrganization();
      await expectEmpty(await app.request('POST', '/api/v1/publish/pdf/ramadan', { token, json: { orgId: other.organization.id, year: 2026 } }), 403);
      expect((await app.request('POST', '/api/v1/publish/pdf/ramadan', { token, json: { orgId: organization.id, year: 'soon' } })).status).toBe(400);
    });
  });

  describe('GET /api/v1/publish/artifacts', () => {
    it('lists the artifacts of the organization and year, newest first', async () => {
      const older = await seedArtifact(2026, 2, '2026-02-01T10:00:00.000Z');
      const newer = await seedArtifact(2026, 0, '2026-02-03T10:00:00.000Z');
      await seedArtifact(2025, 2, '2026-02-04T10:00:00.000Z');
      const other = await otherOrganization();
      await seedArtifact(2026, 2, '2026-02-05T10:00:00.000Z', other.organization.id);

      const response = await app.request('GET', `/api/v1/publish/artifacts?orgId=${organization.id.toUpperCase()}&year=2026&year=2025`, { token });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        { id: newer, organizationId: organization.id, year: 2026, month: 0, size: 'Tabloid', orientation: 'Landscape', storageUrl: `https://cdn.deentime.test/pdfs/${newer}.pdf?sig=a%20b`, createdAtUtc: '2026-02-03T10:00:00.000Z' },
        { id: older, organizationId: organization.id, year: 2026, month: 2, size: 'Tabloid', orientation: 'Landscape', storageUrl: `https://cdn.deentime.test/pdfs/${older}.pdf?sig=a%20b`, createdAtUtc: '2026-02-01T10:00:00.000Z' },
      ]);
      expect(await (await app.request('GET', `/api/v1/publish/artifacts?orgId=${organization.id}`, { token })).json()).toEqual([]);
    });

    it('binds the query like ASP.NET: 400 for unparsable values, 403 for a missing or foreign organization', async () => {
      const invalid = await app.request('GET', '/api/v1/publish/artifacts?orgId=nope&year=soon', { token });
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await invalid.json()).toMatchObject({
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { orgId: ["The value 'nope' is not valid."], year: ["The value 'soon' is not valid."] },
      });
      const blank = await app.request('GET', '/api/v1/publish/artifacts?orgId=&year=', { token });
      expect(await blank.json()).toMatchObject({ errors: { orgId: ["The value '' is invalid."], year: ["The value '' is invalid."] } });

      await expectEmpty(await app.request('GET', '/api/v1/publish/artifacts?year=2026', { token }), 403);
      const other = await otherOrganization();
      await expectEmpty(await app.request('GET', `/api/v1/publish/artifacts?orgId=${other.organization.id}&year=2026`, { token }), 403);
    });
  });

  describe('GET /api/v1/publish/pdf/:artifactId', () => {
    it('redirects to the stored URL as-is', async () => {
      const id = await seedArtifact(2026, 2, '2026-02-01T10:00:00.000Z');
      const response = await app.request('GET', `/api/v1/publish/pdf/${id.toUpperCase()}`, { token });
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(`https://cdn.deentime.test/pdfs/${id}.pdf?sig=a%20b`);
      expect(await response.text()).toBe('');
    });

    it('answers 404 for an unknown or malformed id and 403 for an artifact of another organization', async () => {
      await expectNotFound(await app.request('GET', `/api/v1/publish/pdf/${UNKNOWN_ID}`, { token }));
      await expectNotFound(await app.request('GET', '/api/v1/publish/pdf/not-a-guid', { token }));
      const other = await otherOrganization();
      const foreign = await seedArtifact(2026, 2, '2026-02-01T10:00:00.000Z', other.organization.id);
      await expectEmpty(await app.request('GET', `/api/v1/publish/pdf/${foreign}`, { token }), 403);
      expect((await app.request('GET', `/api/v1/publish/pdf/${foreign}`, { token: await superUserToken() })).status).toBe(302);
    });
  });
});
