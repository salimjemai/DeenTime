import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, toJsonArray } from '../src/core/db.js';
import { salahToDb, type SalahType } from '../src/core/json.js';
import { RATE_LIMIT_POLICIES } from '../src/core/rate-limit.js';
import { createTestApp, TEST_PUBLIC_BASE_URL, type SeededOrganization, type TestApp } from './support/test-app.js';

/**
 * Route-level tests of /public and the legacy redirects, ported from backend-node's
 * public.controller.spec.ts. The reference bodies were captured from the .NET API for the
 * dev organization "dev-test-masjid" on 2026-09-10 (America/Chicago), hence the frozen clock.
 */
const SLUG = 'dev-test-masjid';
const DESIGN_UPDATED_AT = '2026-09-10T20:11:07.100Z';
const DESIGN_TICKS = '639246678671000000';
const HEADINGS = ['FAJR', 'IQM*', 'SUNRISE', 'DUHUR', 'IQM*', 'ASR', 'IQM*', 'SUNSET', 'ISHA', 'IQM*'];
const NOT_FOUND = { type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: 'Not Found', status: 404 };

/** GET /public/display/dev-test-masjid?layout=tv&fontScale=120&theme=Light&locale=ar as the .NET API answered it. */
const referenceDisplay = {
  organization: { name: 'Dev Test Masjid', slug: SLUG, addressLine: '100 Test Street', city: 'Austin', state: 'TX' },
  date: '2026-09-10',
  timezoneId: 'America/Chicago',
  timings: { date: '2026-09-10', fajr: '06:05:00', sunrise: '07:12:00', dhuhr: '13:33:00', asr: '17:00:00', maghrib: '19:44:00', sunset: '19:43:00', isha: '20:50:00' },
  iqama: [],
  monthlyPdfUrl: null,
  design: {
    headerImageUrl: null,
    backgroundImageUrl: null,
    iqamaHeadings: HEADINGS,
    footerHtml: '© 2026 Dev Test Masjid · MasjidHub',
    theme: 'default',
    tvFontScale: 120,
    widgetFontScale: 100,
    compactFontScale: 100,
    tvFontFamily: 'system',
    widgetFontFamily: 'system',
    compactFontFamily: 'system',
    locale: 'ar',
  },
  hijri: { day: 28, month: 3, year: 1448, monthName: 'Rabi al-Awwal', formatted: 'Rabi al-Awwal 28, 1448' },
  tvConfig: { showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 160, autoRefreshSeconds: 30 },
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('public', () => {
  let app: TestApp;
  let organization: SeededOrganization;

  beforeAll(async () => {
    // 17:00 in America/Chicago on 2026-09-10, the day the reference responses were captured.
    vi.useFakeTimers({ toFake: ['Date'] });
    app = await createTestApp();
  });
  afterAll(() => {
    vi.useRealTimers();
  });
  beforeEach(async () => {
    vi.setSystemTime(new Date('2026-09-10T22:00:00Z'));
    await app.reset();
  });

  async function seedOrganization(options: { criteria?: boolean; design?: boolean; headerImageUrl?: string | null } = {}): Promise<void> {
    organization = await app.seed.organization({ name: 'Dev Test Masjid', slug: SLUG, columns: { AddressLine: '100 Test Street', City: 'Austin', State: 'TX' } });
    if (options.criteria !== false) {
      await app.db.run(
        `INSERT INTO "PrayerTimingCriteria" ("Id", "OrganizationId", "Method", "JuristicMethodAsr", "Latitude", "Longitude", "TimezoneId", "DstObserved", "DstBegins", "DstEnds", "ZipCode", "MinutesAfterZawal", "MinutesAfterMaghrib", "KhutbahTimeMinutes", "UpdatedAtUtc")
         VALUES (?, ?, 'ISNA', 'Other', 30.506, -97.7472, 'America/Chicago', 1, NULL, NULL, '78717', 5, 1, 20, ?)`,
        newId(),
        organization.id,
        DESIGN_UPDATED_AT,
      );
    }
    if (options.design !== false) {
      await app.db.run(
        `INSERT INTO "DesignSettings" ("Id", "OrganizationId", "HeaderImageUrl", "IqamaHeadings", "FooterHtml", "Theme", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?, 'default', ?)`,
        newId(),
        organization.id,
        options.headerImageUrl ?? null,
        toJsonArray(HEADINGS),
        '© 2026 Dev Test Masjid · MasjidHub',
        DESIGN_UPDATED_AT,
      );
    }
  }

  async function seedIqama(salah: SalahType, time: string, overrides: { date?: string; offsetMinutes?: number; note?: string; organizationId?: string } = {}): Promise<void> {
    await app.db.run(
      'INSERT INTO "IqamaEntries" ("Id", "OrganizationId", "Date", "Salah", "Time", "Note", "UpdatedAtUtc", "OffsetMinutes") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      overrides.organizationId ?? organization.id,
      overrides.date ?? '2026-01-01',
      salahToDb(salah),
      `${time}:00`,
      overrides.note ?? null,
      '2026-01-01T00:00:00.000Z',
      overrides.offsetMinutes ?? null,
    );
  }

  async function seedHijriMap(year: number, month: number, day: number, hijriMonth: number, hijriYear: number): Promise<void> {
    await app.db.run(
      'INSERT INTO "HijriMonthMaps" ("Id", "OrganizationId", "Year", "Month", "HijriDayOnFirst", "Locked", "UpdatedAtUtc", "HijriMonthOnFirst", "HijriYearOnFirst") VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
      newId(),
      organization.id,
      year,
      month,
      day,
      DESIGN_UPDATED_AT,
      hijriMonth,
      hijriYear,
    );
  }

  async function seedArtifact(year: number, month: number, storageUrl: string, createdAtUtc: string): Promise<void> {
    await app.db.run(
      'INSERT INTO "PublishArtifacts" ("Id", "OrganizationId", "Year", "Month", "Size", "Orientation", "StorageUrl", "CreatedAtUtc") VALUES (?, ?, ?, ?, 0, 0, ?, ?)',
      newId(),
      organization.id,
      year,
      month,
      storageUrl,
      createdAtUtc,
    );
  }

  const display = (query = '', slug = SLUG): Promise<Response> => app.request('GET', `/public/display/${slug}${query}`);

  describe('GET /public/display/:slug', () => {
    it('answers exactly like the .NET API for the reference organization', async () => {
      await seedOrganization();
      const response = await display('?layout=tv&fontScale=120&theme=Light&locale=ar');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBeNull();
      const body = (await response.json()) as Json;
      expect(body).toEqual(referenceDisplay);
      expect(Object.keys(body)).toEqual(['organization', 'date', 'timezoneId', 'timings', 'iqama', 'monthlyPdfUrl', 'design', 'hijri', 'tvConfig']);
      expect(Object.keys(body.design)).toEqual(Object.keys(referenceDisplay.design));
    });

    it('matches the route and its query keys case-insensitively, the slug case-sensitively', async () => {
      await seedOrganization();
      const response = await app.request('GET', `/PUBLIC/Display/${SLUG}/?LAYOUT=tv&FontScale=120`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as Json).design.tvFontScale).toBe(120);
      expect((await display('', 'Dev-Test-Masjid')).status).toBe(404);
    });

    it('uses the saved design and TV configuration, the default locale and the newest artifact of the current local month', async () => {
      await seedOrganization();
      await app.db.run(
        `INSERT INTO "TvDisplayConfigs" ("Id", "OrganizationId", "ShowSeconds", "ShowHijri", "AccentColor", "AutoRefreshSeconds", "ClockFontScale") VALUES (?, ?, 0, 0, '#123456', 45, 120)`,
        newId(),
        organization.id,
      );
      await seedArtifact(2026, 9, 'https://cdn.deentime.test/pdfs/2026-09-old.pdf', '2026-09-01T00:00:00.000Z');
      await seedArtifact(2026, 9, 'https://cdn.deentime.test/pdfs/2026-09.pdf', '2026-09-02T00:00:00.000Z');
      await seedArtifact(2026, 8, 'https://cdn.deentime.test/pdfs/2026-08.pdf', '2026-09-03T00:00:00.000Z');
      await seedArtifact(2026, 0, 'https://cdn.deentime.test/pdfs/ramadan.pdf', '2026-09-04T00:00:00.000Z');
      const body = (await (await display()).json()) as Json;
      expect(body.design).toMatchObject({ theme: 'default', locale: 'en-US', tvFontScale: 100, widgetFontScale: 100, compactFontScale: 100 });
      expect(body.monthlyPdfUrl).toBe('https://cdn.deentime.test/pdfs/2026-09.pdf');
      expect(body.tvConfig).toEqual({ showSeconds: false, showHijri: false, accentColor: '#123456', clockFontScale: 120, autoRefreshSeconds: 45 });
    });

    it('shifts the Hijri date with the month map and applies the query font scale to the requested layout only', async () => {
      await seedOrganization();
      await seedHijriMap(2026, 9, 20, 3, 1448);
      await seedHijriMap(2026, 8, 1, 1, 1448);
      const response = await display('?layout=WIDGET&fontScale=+155&theme=DARK');
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(body.hijri).toEqual({ day: 29, month: 3, year: 1448, monthName: 'Rabi al-Awwal', formatted: 'Rabi al-Awwal 29, 1448' });
      expect(body.design).toMatchObject({ theme: 'dark', tvFontScale: 100, widgetFontScale: 155, compactFontScale: 100 });
    });

    it('returns the ApiController 404 ProblemDetails for an unknown slug', async () => {
      await seedOrganization();
      const response = await display('', 'definitely-unknown');
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      const body = (await response.json()) as Json;
      expect(body).toMatchObject(NOT_FOUND);
      expect(body.traceId).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it('rejects unbindable and invalid query parameters before looking the organization up', async () => {
      const binding = await display('?fontScale=abc&locale=!!');
      expect(binding.status).toBe(400);
      expect(binding.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await binding.json()).toMatchObject({ title: 'One or more validation errors occurred.', status: 400, errors: { fontScale: ["The value 'abc' is not valid."] } });

      for (const [query, message] of [
        ['fontScale=101', 'fontScale must be between 75 and 160 in increments of 5.'],
        ['fontScale=74', 'fontScale must be between 75 and 160 in increments of 5.'],
        ['locale=xx-YYY', 'locale must be a supported language tag.'],
        ['theme=neon', 'theme must be default, dark, or classic.'],
        ['layout=phone', 'layout must be tv, widget, or compact.'],
        ['locale=b%40d&theme=bad&fontScale=1&layout=bad', 'locale must be a supported language tag.'],
      ]) {
        const response = await display(`?${query}`);
        expect(response.status, query).toBe(400);
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe(message);
      }

      for (const query of ['theme=', 'theme=Light', 'fontScale=%20100%20', 'layout=TV', 'locale=%20%20', 'fontScale=80&fontScale=abc']) {
        expect((await display(`?${query}`)).status, query).toBe(404);
      }
    });

    it('shapes the iqama list from the latest entry per Salah dated on or before today', async () => {
      await seedOrganization();
      const other = await app.seed.organization();
      await seedIqama('Isha', '23:50', { note: 'Fixed Isha' });
      await seedIqama('Isha', '23:00', { date: '2025-06-01', note: 'superseded' });
      await seedIqama('Maghrib', '19:30', { offsetMinutes: -10, note: 'ignored' });
      await seedIqama('Jumuah', '13:30');
      await seedIqama('Fajr', '06:00', { offsetMinutes: 20, date: '2026-09-10' });
      await seedIqama('Fajr', '05:30', { date: '2026-09-09', note: 'yesterday, superseded' });
      await seedIqama('Fajr', '05:00', { date: '2026-09-11', note: 'tomorrow, not yet effective' });
      await seedIqama('Asr', '17:30', { date: '2025-12-01' });
      await seedIqama('Dhuhr', '13:45', { organizationId: other.id });
      const body = (await (await display()).json()) as Json;
      expect(body.iqama).toEqual([
        { salah: 'Fajr', time: '06:25', salahTime: null, offsetMinutes: 20, note: '+20 minutes', effectiveDate: '2026-09-10' },
        { salah: 'Jumuah', time: '13:30', salahTime: '13:50', offsetMinutes: null, note: null, effectiveDate: '2026-01-01' },
        { salah: 'Asr', time: '17:30', salahTime: null, offsetMinutes: null, note: null, effectiveDate: '2025-12-01' },
        { salah: 'Maghrib', time: '19:34', salahTime: null, offsetMinutes: -10, note: '+-10 minutes', effectiveDate: '2026-01-01' },
        { salah: 'Isha', time: '23:50', salahTime: null, offsetMinutes: null, note: 'Fixed Isha', effectiveDate: '2026-01-01' },
      ]);
    });

    it('falls back to UTC, no timings and the default khutbah length without criteria or design', async () => {
      await seedOrganization({ criteria: false, design: false });
      await seedIqama('Fajr', '06:00', { offsetMinutes: 20 });
      await seedIqama('Jumuah', '13:30');
      await seedIqama('Jumuah2nd', '14:00', { offsetMinutes: 5 });
      const response = await display();
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(body).toMatchObject({ date: '2026-09-10', timezoneId: 'UTC', timings: null, hijri: referenceDisplay.hijri, tvConfig: referenceDisplay.tvConfig });
      expect(body.design).toEqual({ ...referenceDisplay.design, iqamaHeadings: [], footerHtml: null, tvFontScale: 100, locale: 'en-US' });
      expect(body.iqama).toEqual([
        { salah: 'Fajr', time: null, salahTime: null, offsetMinutes: 20, note: '+20 minutes', effectiveDate: '2026-01-01' },
        { salah: 'Jumuah', time: '13:30', salahTime: '14:00', offsetMinutes: null, note: null, effectiveDate: '2026-01-01' },
        { salah: 'Jumuah2nd', time: null, salahTime: null, offsetMinutes: 5, note: '+5 minutes', effectiveDate: '2026-01-01' },
      ]);
    });

    it('uses the local date of the organization when it differs from the UTC date', async () => {
      // 21:00 on 2026-09-30 in Chicago, already 2026-10-01 in UTC.
      vi.setSystemTime(new Date('2026-10-01T02:00:00Z'));
      await seedOrganization();
      await seedHijriMap(2026, 9, 20, 3, 1448);
      await seedHijriMap(2026, 10, 1, 1, 1400);
      await seedArtifact(2026, 9, 'https://cdn.deentime.test/pdfs/2026-09.pdf', '2026-09-02T00:00:00.000Z');
      await seedArtifact(2026, 10, 'https://cdn.deentime.test/pdfs/2026-10.pdf', '2026-09-03T00:00:00.000Z');
      await seedIqama('Fajr', '06:00', { date: '2026-09-30' });
      await seedIqama('Fajr', '05:00', { date: '2026-10-01', note: 'tomorrow, not yet effective' });
      await seedIqama('Isha', '21:00', { date: '2026-09-29' });
      const body = (await (await display()).json()) as Json;
      expect(body.date).toBe('2026-09-30');
      expect(body.timings.date).toBe('2026-09-30');
      expect(body.monthlyPdfUrl).toBe('https://cdn.deentime.test/pdfs/2026-09.pdf');
      expect(body.hijri).toMatchObject({ month: 4, year: 1448 });
      expect(body.iqama.map((item: Json) => [item.salah, item.time, item.effectiveDate])).toEqual([
        ['Fajr', '06:00', '2026-09-30'],
        ['Isha', '21:00', '2026-09-29'],
      ]);
    });

    it('versions a relative header image against the public origin with the design ticks', async () => {
      await seedOrganization({ headerImageUrl: '/uploads/orgs/x/header-abc.png' });
      const body = (await (await display()).json()) as Json;
      expect(body.design.headerImageUrl).toBe(`${TEST_PUBLIC_BASE_URL}/uploads/orgs/x/header-abc.png?v=${DESIGN_TICKS}`);
      expect(body.design.backgroundImageUrl).toBe(body.design.headerImageUrl);
    });

    it('keeps an absolute header image and appends the version to its query', async () => {
      await seedOrganization({ headerImageUrl: 'https://cdn.deentime.test/header.png?size=large' });
      const body = (await (await display()).json()) as Json;
      expect(body.design.headerImageUrl).toBe(`https://cdn.deentime.test/header.png?size=large&v=${DESIGN_TICKS}`);
    });

    it('answers 429 with an empty body once the public rate limit is used up', async () => {
      await seedOrganization();
      for (let index = 0; index < RATE_LIMIT_POLICIES.public.permitLimit; index++) expect((await display('', 'unknown')).status).toBe(404);
      const limited = await display();
      expect(limited.status).toBe(429);
      expect(await limited.text()).toBe('');
      expect((await app.request('GET', `/public/tv/${SLUG}`)).status).toBe(429);
      expect((await app.request('GET', '/clock?masjid=abc')).status).toBe(429);
    });
  });

  describe('GET /public/organizations/:slug/displays', () => {
    it('lists the embeds with the ResponseCache no-store headers', async () => {
      await seedOrganization();
      const response = await app.request('GET', `/public/organizations/${SLUG}/displays`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store,no-cache');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      const body = (await response.json()) as Json;
      const title = 'MasjidHub &#183; Dev Test Masjid prayer times';
      const script = `<script async src="${TEST_PUBLIC_BASE_URL}/iqamatime-embed.js"></script>`;
      const frame = (url: string, frameTitle: string, width: string, height: string, auto: boolean): string =>
        `<iframe src="${url}" title="${frameTitle}" width="${width}" height="${height}" loading="lazy"${auto ? ' data-iqamatime-auto-height' : ''} style="display:block;border:0;max-width:100%;overflow:hidden"></iframe>${auto ? script : ''}`;
      const url = (path: string): string => `${TEST_PUBLIC_BASE_URL}${path}`;
      expect(body).toEqual({
        organization: { name: 'Dev Test Masjid', slug: SLUG },
        displays: {
          tv: { url: url(`/tv/${SLUG}`), iframe: frame(url(`/tv/${SLUG}`), title, '100%', '720', false) },
          widget: { url: url(`/w/${SLUG}`), iframe: frame(url(`/w/${SLUG}`), title, '390', '920', true) },
          combined: { url: url(`/w/${SLUG}`), iframe: frame(url(`/w/${SLUG}`), title, '390', '920', true) },
          daily: { url: url(`/w/${SLUG}/daily`), iframe: frame(url(`/w/${SLUG}/daily`), 'MasjidHub &#183; Dev Test Masjid daily prayer times', '390', '720', true) },
          jumuah: { url: url(`/w/${SLUG}/jumuah`), iframe: frame(url(`/w/${SLUG}/jumuah`), 'MasjidHub &#183; Dev Test Masjid Friday prayer times', '390', '560', true) },
          compact: { url: url(`/w2/${SLUG}`), iframe: frame(url(`/w2/${SLUG}`), title, '330', '820', true) },
        },
        supportedParameters: { locale: ['en-US', 'ar', 'ur'], theme: ['default', 'dark', 'classic'], fontScale: { min: 75, max: 160, step: 5 }, layout: ['tv', 'widget', 'compact'] },
        defaults: { theme: 'default', fontScale: 100, locale: 'en-US' },
        provider: 'MasjidHub',
      });
      expect(Object.keys(body.displays)).toEqual(['tv', 'widget', 'combined', 'daily', 'jumuah', 'compact']);
    });

    it('HTML-encodes the organization name in the iframe titles', async () => {
      await app.seed.organization({ name: 'Al-Noor <Masjid> & "Center"', slug: 'al-noor' });
      const body = (await (await app.request('GET', '/public/organizations/al-noor/displays')).json()) as Json;
      expect(body.organization.name).toBe('Al-Noor <Masjid> & "Center"');
      expect(body.displays.tv.iframe).toContain('title="MasjidHub &#183; Al-Noor &lt;Masjid&gt; &amp; &quot;Center&quot; prayer times"');
    });

    it('returns 404 with the no-store headers for an unknown slug', async () => {
      const response = await app.request('GET', '/public/organizations/definitely-unknown/displays');
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store,no-cache');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await response.json()).toMatchObject(NOT_FOUND);
    });
  });

  describe('redirects', () => {
    it.each([
      ['/public/widget/dev-test-masjid', '/w/dev-test-masjid'],
      ['/public/widget/dev-test-masjid/daily', '/w/dev-test-masjid/daily'],
      ['/public/widget/dev-test-masjid/jumuah', '/w/dev-test-masjid/jumuah'],
      ['/public/tv/dev-test-masjid', '/tv/dev-test-masjid'],
      ['/Public/TV/Dev-Test-Masjid', '/tv/Dev-Test-Masjid'],
      ['/public/widget/a%20b', '/w/a b'],
      ['/public/tv/a%2Fb%3Fc', '/tv/a%2Fb%3Fc'],
      ['/public/tv/a%09b%7Fc', '/tv/a%09b%7Fc'],
      ['/public/widget/a%22b%3Cc%3E', '/w/a"b<c>'],
      ['/clock?masjid=abc', '/tv/abc'],
      ['/Clock?Masjid=abc', '/tv/abc'],
      ['/clock?masjid=a+b&masjid=c', '/tv/a b'],
      ['/iqama-widget.php?x?my-slug', '/w/my-slug'],
      ['/iqama-widget.php?a=1&b=2?slug?extra', '/w/slug'],
      ['/iqama-widget.php?x?my%20slug', '/w/my%2520slug'],
      ['/iqama-widget.php?masjid=abc', '/w/abc'],
      ['/iqama-widget2.php?masjid=abc', '/w2/abc'],
      ['/IQAMA-WIDGET2.PHP?x?abc', '/w2/abc'],
      ['/iqama-widget2.php?x?abc', '/w2/abc'],
    ])('GET %s redirects to %s', async (path, location) => {
      const response = await app.request('GET', path);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(`${TEST_PUBLIC_BASE_URL}${location}`);
      expect(await response.text()).toBe('');
    });

    it('fails like Kestrel when the redirect target would carry non-ASCII characters', async () => {
      for (const path of ['/public/tv/caf%C3%A9', '/public/widget/%C3%BF', '/clock?masjid=%C4%80']) {
        const response = await app.request('GET', path);
        expect(response.status, path).toBe(500);
        expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
        expect(response.headers.get('Location')).toBeNull();
      }
    });

    it('requires the masjid query parameter for /clock', async () => {
      for (const path of ['/clock', '/clock?masjid=', '/clock?masjid=%20%20']) {
        const response = await app.request('GET', path);
        expect(response.status, path).toBe(400);
        expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
        expect(await response.json()).toMatchObject({ title: 'One or more validation errors occurred.', status: 400, errors: { masjid: ['The masjid field is required.'] } });
      }
    });

    it('rejects legacy widget requests without a slug', async () => {
      for (const path of ['/iqama-widget.php', '/iqama-widget2.php', '/iqama-widget.php??slug', '/iqama-widget.php?masjid=%20', '/iqama-widget2.php?x=1']) {
        const response = await app.request('GET', path);
        expect(response.status, path).toBe(400);
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe('Missing organization slug');
      }
    });
  });
});

describe('public without Frontend:PublicBaseUrl', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the origin from the forwarded headers or the request host, forcing https outside Development', async () => {
    const app = await createTestApp({ settings: { Frontend__PublicBaseUrl: '' } });
    await app.reset();
    const forwarded = await app.request('GET', '/public/widget/slug', { headers: { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'iqamatime.com, internal' } });
    expect(forwarded.status).toBe(302);
    expect(forwarded.headers.get('Location')).toBe('https://iqamatime.com/w/slug');
    const fromHost = await app.request('GET', '/public/tv/slug');
    expect(fromHost.headers.get('Location')).toBe('https://masjidhub.test/tv/slug');
    const loopback = await app.request('GET', '/public/widget/slug', { headers: { 'X-Forwarded-Host': 'localhost:3000' } });
    expect(loopback.status).toBe(500);
    expect(loopback.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    const unknown = await app.request('GET', '/public/organizations/slug/displays', { headers: { 'X-Forwarded-Host': 'localhost:3000' } });
    expect(unknown.status).toBe(404);
  });

  it('allows a local http origin in Development', async () => {
    const app = await createTestApp({ settings: { Frontend__PublicBaseUrl: '', ASPNETCORE_ENVIRONMENT: 'Development' } });
    await app.reset();
    const local = await app.request('GET', '/public/widget/slug', { headers: { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'localhost:3000' } });
    expect(local.status).toBe(302);
    expect(local.headers.get('Location')).toBe('http://localhost:3000/w/slug');
  });
});
