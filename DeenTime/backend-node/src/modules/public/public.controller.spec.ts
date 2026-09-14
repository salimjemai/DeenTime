import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { salahToDb, timeOnly, timeOnlyToDb, type SalahType } from '../../common/json.js';
import { ProblemDetailsFilter } from '../../common/problem-details.filter.js';
import { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LegacyRedirectController } from './legacy-redirect.controller.js';
import { PublicController } from './public.controller.js';

/**
 * HTTP-level tests of the public module with a stubbed PrismaService. The reference
 * bodies were captured from the .NET API for the dev organization "dev-test-masjid"
 * on 2026-09-10 (America/Chicago), which is why the clock is frozen.
 */
interface CriteriaRow {
  id: string;
  organizationId: string;
  method: string;
  juristicMethodAsr: string;
  latitude: number;
  longitude: number;
  timezoneId: string;
  dstObserved: boolean;
  dstBegins: Date | null;
  dstEnds: Date | null;
  zipCode: string;
  minutesAfterZawal: number;
  minutesAfterMaghrib: number;
  khutbahTimeMinutes: number;
  updatedAtUtc: Date;
}

interface DesignRow {
  id: string;
  organizationId: string;
  headerImageUrl: string | null;
  iqamaHeadings: string[];
  footerHtml: string | null;
  theme: string;
  tvFontScale: number;
  widgetFontScale: number;
  compactFontScale: number;
  tvFontFamily: string;
  widgetFontFamily: string;
  compactFontFamily: string;
  updatedAtUtc: Date;
}

interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  criteria: CriteriaRow | null;
  design: DesignRow | null;
}

interface IqamaRow {
  id: string;
  organizationId: string;
  date: Date;
  salah: number;
  time: Date;
  offsetMinutes: number | null;
  note: string | null;
  updatedAtUtc: Date;
}

interface FakeState {
  organization: OrganizationRow | null;
  iqama: IqamaRow[];
  hijri: { year: number; month: number; hijriDayOnFirst: number; hijriMonthOnFirst: number; hijriYearOnFirst: number } | null;
  tvConfig: { showSeconds: boolean; showHijri: boolean; accentColor: string; clockFontScale: number; autoRefreshSeconds: number } | null;
  artifact: { storageUrl: string } | null;
  designUtc: string | null;
  queries: unknown[];
}

const ORG_ID = '6407ba17-569d-4605-8a5b-d04cd5dffdd2';

const criteria: CriteriaRow = {
  id: '4a0c1a9e-0000-4000-8000-000000000001',
  organizationId: ORG_ID,
  method: 'ISNA',
  juristicMethodAsr: 'Other',
  latitude: 30.506,
  longitude: -97.7472,
  timezoneId: 'America/Chicago',
  dstObserved: true,
  dstBegins: null,
  dstEnds: null,
  zipCode: '78717',
  minutesAfterZawal: 5,
  minutesAfterMaghrib: 1,
  khutbahTimeMinutes: 20,
  updatedAtUtc: new Date('2026-09-10T20:11:07.100Z'),
};

const design: DesignRow = {
  id: '8e55b5a7-21f5-46d3-b4f7-58f3cbb63ad9',
  organizationId: ORG_ID,
  headerImageUrl: null,
  iqamaHeadings: ['FAJR', 'IQM*', 'SUNRISE', 'DUHUR', 'IQM*', 'ASR', 'IQM*', 'SUNSET', 'ISHA', 'IQM*'],
  footerHtml: '© 2026 Dev Test Masjid · IqamaTime',
  theme: 'default',
  tvFontScale: 100,
  widgetFontScale: 100,
  compactFontScale: 100,
  tvFontFamily: 'system',
  widgetFontFamily: 'system',
  compactFontFamily: 'system',
  updatedAtUtc: new Date('2026-09-10T20:11:07.100Z'),
};

const organization: OrganizationRow = {
  id: ORG_ID,
  slug: 'dev-test-masjid',
  name: 'Dev Test Masjid',
  addressLine: '100 Test Street',
  city: 'Austin',
  state: 'TX',
  criteria,
  design,
};

/** GET /public/display/dev-test-masjid?layout=tv&fontScale=120&theme=Light&locale=ar as the .NET API answered it. */
const referenceDisplay = {
  organization: { name: 'Dev Test Masjid', slug: 'dev-test-masjid', addressLine: '100 Test Street', city: 'Austin', state: 'TX' },
  date: '2026-09-10',
  timezoneId: 'America/Chicago',
  timings: { date: '2026-09-10', fajr: '06:05:00', sunrise: '07:12:00', dhuhr: '13:33:00', asr: '17:00:00', maghrib: '19:44:00', sunset: '19:43:00', isha: '20:50:00' },
  iqama: [],
  monthlyPdfUrl: null,
  design: {
    headerImageUrl: null,
    backgroundImageUrl: null,
    iqamaHeadings: ['FAJR', 'IQM*', 'SUNRISE', 'DUHUR', 'IQM*', 'ASR', 'IQM*', 'SUNSET', 'ISHA', 'IQM*'],
    footerHtml: '© 2026 Dev Test Masjid · IqamaTime',
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

const PUBLIC_BASE_URL = 'https://public.deentime.test';
const NOT_FOUND = { type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: 'Not Found', status: 404 };

function iqamaRow(salah: SalahType, time: string, options: { date?: string; offsetMinutes?: number | null; note?: string | null } = {}): IqamaRow {
  const [hour, minute] = time.split(':').map(Number);
  return {
    id: `00000000-0000-4000-8000-${String(salahToDb(salah)).padStart(12, '0')}`,
    organizationId: ORG_ID,
    date: new Date(`${options.date ?? '2026-01-01'}T00:00:00Z`),
    salah: salahToDb(salah),
    time: timeOnlyToDb(timeOnly(hour, minute)),
    offsetMinutes: options.offsetMinutes ?? null,
    note: options.note ?? null,
    updatedAtUtc: new Date('2026-01-01T12:00:00Z'),
  };
}

function fakePrisma(state: FakeState): unknown {
  return {
    organization: {
      findUnique: async (args: { where: { slug: string } }) => (state.organization && state.organization.slug === args.where.slug ? state.organization : null),
    },
    iqamaEntry: {
      findMany: async (args: { where: { organizationId: string; date: { lte: Date } } }) => {
        state.queries.push(args);
        return state.iqama.filter((row) => row.organizationId === args.where.organizationId && row.date.getTime() <= args.where.date.lte.getTime());
      },
    },
    hijriMonthMap: {
      findFirst: async (args: unknown) => {
        state.queries.push(args);
        return state.hijri;
      },
    },
    tvDisplayConfig: { findFirst: async () => state.tvConfig },
    publishArtifact: {
      findFirst: async (args: unknown) => {
        state.queries.push(args);
        return state.artifact;
      },
    },
    pool: {
      query: async (sql: string, values: unknown[]) => {
        state.queries.push({ sql, values });
        return { rows: state.designUtc === null ? [] : [{ utc: state.designUtc }] };
      },
    },
  };
}

function emptyState(overrides: Partial<FakeState> = {}): FakeState {
  return { organization, iqama: [], hijri: null, tvConfig: null, artifact: null, designUtc: null, queries: [], ...overrides };
}

interface Harness {
  app: NestExpressApplication;
  state: FakeState;
  http(): request.Agent;
}

async function bootstrap(state: FakeState, options: { publicBaseUrl?: string | null; environmentName?: string } = {}): Promise<Harness> {
  const overrides: Record<string, string> = {};
  const publicBaseUrl = options.publicBaseUrl === undefined ? PUBLIC_BASE_URL : options.publicBaseUrl;
  if (publicBaseUrl !== null) overrides['Frontend:PublicBaseUrl'] = publicBaseUrl;
  const config = AppConfig.load({ contentRoot: tmpdir(), env: {}, overrides, environmentName: options.environmentName ?? 'Testing' });
  const moduleRef = await Test.createTestingModule({
    controllers: [PublicController, LegacyRedirectController],
    providers: [
      { provide: PrismaService, useValue: fakePrisma(state) },
      { provide: AppConfig, useValue: config },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.useGlobalFilters(new ProblemDetailsFilter(tmpdir()));
  await app.init();
  return { app, state, http: () => request(app.getHttpServer()) };
}

describe('PublicController', () => {
  const apps: NestExpressApplication[] = [];
  const start = async (state: FakeState, options?: Parameters<typeof bootstrap>[1]): Promise<Harness> => {
    const harness = await bootstrap(state, options);
    apps.push(harness.app);
    return harness;
  };

  beforeAll(() => {
    // 17:00 in America/Chicago on 2026-09-10, the day the reference responses were captured.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T22:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  describe('GET /public/display/:slug', () => {
    it('answers exactly like the .NET API for the reference organization', async () => {
      const { http } = await start(emptyState());
      const response = await http().get('/public/display/dev-test-masjid?layout=tv&fontScale=120&theme=Light&locale=ar');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toEqual(referenceDisplay);
      expect(Object.keys(response.body)).toEqual(['organization', 'date', 'timezoneId', 'timings', 'iqama', 'monthlyPdfUrl', 'design', 'hijri', 'tvConfig']);
    });

    it('uses the saved design, the default locale and the current local month for the lookups', async () => {
      const { http, state } = await start(emptyState({ artifact: { storageUrl: 'https://cdn.deentime.test/pdfs/2026-09.pdf' }, tvConfig: { showSeconds: false, showHijri: false, accentColor: '#123456', clockFontScale: 120, autoRefreshSeconds: 45 } }));
      const response = await http().get('/public/display/dev-test-masjid');
      expect(response.status).toBe(200);
      expect(response.body.design).toMatchObject({ theme: 'default', locale: 'en-US', tvFontScale: 100, widgetFontScale: 100, compactFontScale: 100 });
      expect(response.body.monthlyPdfUrl).toBe('https://cdn.deentime.test/pdfs/2026-09.pdf');
      expect(response.body.tvConfig).toEqual({ showSeconds: false, showHijri: false, accentColor: '#123456', clockFontScale: 120, autoRefreshSeconds: 45 });
      expect(state.queries).toContainEqual({ where: { organizationId: ORG_ID, year: 2026, month: 9 } });
      expect(state.queries).toContainEqual({ where: { organizationId: ORG_ID, year: 2026, month: 9 }, orderBy: { createdAtUtc: 'desc' }, select: { storageUrl: true } });
      expect(state.queries).toContainEqual({ where: { organizationId: ORG_ID, date: { lte: new Date('2026-09-10T00:00:00Z') } } });
    });

    it('shifts the Hijri date with the month map and applies the query font scale to the requested layout only', async () => {
      const { http } = await start(emptyState({ hijri: { year: 2026, month: 9, hijriDayOnFirst: 20, hijriMonthOnFirst: 3, hijriYearOnFirst: 1448 } }));
      const response = await http().get('/public/display/dev-test-masjid?layout=WIDGET&fontScale=+155&theme=DARK');
      expect(response.status).toBe(200);
      expect(response.body.hijri).toEqual({ day: 29, month: 3, year: 1448, monthName: 'Rabi al-Awwal', formatted: 'Rabi al-Awwal 29, 1448' });
      expect(response.body.design).toMatchObject({ theme: 'dark', tvFontScale: 100, widgetFontScale: 155, compactFontScale: 100 });
    });

    it('returns the ApiController 404 ProblemDetails for an unknown slug', async () => {
      const { http } = await start(emptyState());
      const response = await http().get('/public/display/definitely-unknown');
      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(response.body).toMatchObject(NOT_FOUND);
    });

    it('rejects unbindable and invalid query parameters before touching the database', async () => {
      const { http } = await start(emptyState({ organization: null }));
      const binding = await http().get('/public/display/dev-test-masjid?fontScale=abc&locale=!!');
      expect(binding.status).toBe(400);
      expect(binding.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(binding.body).toMatchObject({ title: 'One or more validation errors occurred.', status: 400, errors: { fontScale: ["The value 'abc' is not valid."] } });

      for (const [query, message] of [
        ['fontScale=101', 'fontScale must be between 75 and 160 in increments of 5.'],
        ['fontScale=74', 'fontScale must be between 75 and 160 in increments of 5.'],
        ['locale=xx-YYY', 'locale must be a supported language tag.'],
        ['theme=neon', 'theme must be default, dark, or classic.'],
        ['layout=phone', 'layout must be tv, widget, or compact.'],
        ['locale=b%40d&theme=bad&fontScale=1&layout=bad', 'locale must be a supported language tag.'],
      ]) {
        const response = await http().get(`/public/display/dev-test-masjid?${query}`);
        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toMatch(/^text\/plain/);
        expect(response.text).toBe(message);
      }

      for (const query of ['theme=', 'theme=Light', 'fontScale=%20100%20', 'layout=TV', 'locale=%20%20', 'fontScale=80&fontScale=abc']) {
        const response = await http().get(`/public/display/dev-test-masjid?${query}`);
        expect(response.status, query).toBe(404);
      }
    });

    it('shapes the iqama list from the latest entry per Salah dated on or before today', async () => {
      const iqama = [
        iqamaRow('Isha', '23:50', { note: 'Fixed Isha' }),
        iqamaRow('Maghrib', '19:30', { offsetMinutes: -10, note: 'ignored' }),
        iqamaRow('Jumuah', '13:30'),
        iqamaRow('Fajr', '06:00', { offsetMinutes: 20, date: '2026-09-10' }),
        iqamaRow('Fajr', '05:00', { date: '2026-09-11', note: 'tomorrow, not yet effective' }),
        iqamaRow('Asr', '17:30', { date: '2025-12-01' }),
      ];
      const { http } = await start(emptyState({ iqama }));
      const response = await http().get('/public/display/dev-test-masjid');
      expect(response.status).toBe(200);
      expect(response.body.iqama).toEqual([
        { salah: 'Fajr', time: '06:25', salahTime: null, offsetMinutes: 20, note: '+20 minutes', effectiveDate: '2026-09-10' },
        { salah: 'Jumuah', time: '13:30', salahTime: '13:50', offsetMinutes: null, note: null, effectiveDate: '2026-01-01' },
        { salah: 'Asr', time: '17:30', salahTime: null, offsetMinutes: null, note: null, effectiveDate: '2025-12-01' },
        { salah: 'Maghrib', time: '19:34', salahTime: null, offsetMinutes: -10, note: '+-10 minutes', effectiveDate: '2026-01-01' },
        { salah: 'Isha', time: '23:50', salahTime: null, offsetMinutes: null, note: 'Fixed Isha', effectiveDate: '2026-01-01' },
      ]);
    });

    it('falls back to UTC, no timings and the default khutbah length without criteria', async () => {
      const iqama = [iqamaRow('Fajr', '06:00', { offsetMinutes: 20 }), iqamaRow('Jumuah', '13:30'), iqamaRow('Jumuah2nd', '14:00', { offsetMinutes: 5 })];
      const { http } = await start(emptyState({ organization: { ...organization, criteria: null, design: null }, iqama }));
      const response = await http().get('/public/display/dev-test-masjid');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ date: '2026-09-10', timezoneId: 'UTC', timings: null, hijri: referenceDisplay.hijri });
      expect(response.body.design).toEqual({ ...referenceDisplay.design, iqamaHeadings: [], footerHtml: null, tvFontScale: 100, locale: 'en-US' });
      expect(response.body.iqama).toEqual([
        { salah: 'Fajr', time: null, salahTime: null, offsetMinutes: 20, note: '+20 minutes', effectiveDate: '2026-01-01' },
        { salah: 'Jumuah', time: '13:30', salahTime: '14:00', offsetMinutes: null, note: null, effectiveDate: '2026-01-01' },
        { salah: 'Jumuah2nd', time: null, salahTime: null, offsetMinutes: 5, note: '+5 minutes', effectiveDate: '2026-01-01' },
      ]);
    });

    it('versions a relative header image against the public origin with the microsecond-precise ticks', async () => {
      const withHeader = { ...organization, design: { ...design, headerImageUrl: '/uploads/orgs/x/header-abc.png' } };
      const { http, state } = await start(emptyState({ organization: withHeader, designUtc: '2026-09-10T20:11:07.100348' }));
      const response = await http().get('/public/display/dev-test-masjid');
      expect(response.status).toBe(200);
      expect(response.body.design.headerImageUrl).toBe('https://public.deentime.test/uploads/orgs/x/header-abc.png?v=639246678671003480');
      expect(response.body.design.backgroundImageUrl).toBe(response.body.design.headerImageUrl);
      expect(state.queries).toContainEqual({ sql: expect.stringContaining('"DesignSettings"'), values: [design.id] });
    });

    it('keeps an absolute header image, appends to its query and never needs the public origin', async () => {
      const withHeader = { ...organization, design: { ...design, headerImageUrl: 'https://cdn.deentime.test/header.png?size=large' } };
      const { http } = await start(emptyState({ organization: withHeader, designUtc: null }), { publicBaseUrl: null });
      const response = await http().get('/public/display/dev-test-masjid');
      expect(response.status).toBe(200);
      expect(response.body.design.headerImageUrl).toBe('https://cdn.deentime.test/header.png?size=large&v=639246678671000000');
    });

    it('fails with the .NET 500 when a relative header image needs an origin that cannot be determined', async () => {
      const withHeader = { ...organization, design: { ...design, headerImageUrl: '/uploads/orgs/x/header-abc.png' } };
      const { http } = await start(emptyState({ organization: withHeader }), { publicBaseUrl: null });
      const response = await http().get('/public/display/dev-test-masjid');
      expect(response.status).toBe(500);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    });
  });

  describe('GET /public/organizations/:slug/displays', () => {
    it('lists the embeds with the ResponseCache no-store headers', async () => {
      const { http } = await start(emptyState({ organization: { ...organization, name: 'North Lamar Austin Muslim Community Center', slug: 'north-lamar-austin-muslim-community-center' } }));
      const response = await http().get('/public/organizations/north-lamar-austin-muslim-community-center/displays');
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store,no-cache');
      expect(response.headers.pragma).toBe('no-cache');
      const base = 'https://public.deentime.test';
      const slug = 'north-lamar-austin-muslim-community-center';
      const style = 'style="display:block;border:0;max-width:100%;overflow:hidden"';
      const script = `<script async src="${base}/iqamatime-embed.js"></script>`;
      expect(response.body).toEqual({
        organization: { name: 'North Lamar Austin Muslim Community Center', slug },
        displays: {
          tv: {
            url: `${base}/tv/${slug}`,
            iframe: `<iframe src="${base}/tv/${slug}" title="IqamaTime &#183; North Lamar Austin Muslim Community Center prayer times" width="100%" height="720" loading="lazy" ${style}></iframe>`,
          },
          widget: {
            url: `${base}/w/${slug}`,
            iframe: `<iframe src="${base}/w/${slug}" title="IqamaTime &#183; North Lamar Austin Muslim Community Center prayer times" width="390" height="920" loading="lazy" data-iqamatime-auto-height ${style}></iframe>${script}`,
          },
          combined: {
            url: `${base}/w/${slug}`,
            iframe: `<iframe src="${base}/w/${slug}" title="IqamaTime &#183; North Lamar Austin Muslim Community Center prayer times" width="390" height="920" loading="lazy" data-iqamatime-auto-height ${style}></iframe>${script}`,
          },
          daily: {
            url: `${base}/w/${slug}/daily`,
            iframe: `<iframe src="${base}/w/${slug}/daily" title="IqamaTime &#183; North Lamar Austin Muslim Community Center daily prayer times" width="390" height="720" loading="lazy" data-iqamatime-auto-height ${style}></iframe>${script}`,
          },
          jumuah: {
            url: `${base}/w/${slug}/jumuah`,
            iframe: `<iframe src="${base}/w/${slug}/jumuah" title="IqamaTime &#183; North Lamar Austin Muslim Community Center Friday prayer times" width="390" height="560" loading="lazy" data-iqamatime-auto-height ${style}></iframe>${script}`,
          },
          compact: {
            url: `${base}/w2/${slug}`,
            iframe: `<iframe src="${base}/w2/${slug}" title="IqamaTime &#183; North Lamar Austin Muslim Community Center prayer times" width="330" height="820" loading="lazy" data-iqamatime-auto-height ${style}></iframe>${script}`,
          },
        },
        supportedParameters: { locale: ['en-US', 'ar', 'ur'], theme: ['default', 'dark', 'classic'], fontScale: { min: 75, max: 160, step: 5 }, layout: ['tv', 'widget', 'compact'] },
        defaults: { theme: 'default', fontScale: 100, locale: 'en-US' },
        provider: 'IqamaTime',
      });
    });

    it('HTML-encodes the organization name in the iframe titles', async () => {
      const { http } = await start(emptyState({ organization: { ...organization, name: `Masjid <Al-Noor> & "Friends" 'Café'` } }));
      const response = await http().get('/public/organizations/dev-test-masjid/displays');
      expect(response.status).toBe(200);
      expect(response.body.displays.jumuah.iframe).toContain('title="IqamaTime &#183; Masjid &lt;Al-Noor&gt; &amp; &quot;Friends&quot; &#39;Caf&#233;&#39; Friday prayer times"');
      expect(response.body.organization.name).toBe(`Masjid <Al-Noor> & "Friends" 'Café'`);
    });

    it('returns 404 with the no-store headers for an unknown slug', async () => {
      const { http } = await start(emptyState());
      const response = await http().get('/public/organizations/definitely-unknown/displays');
      expect(response.status).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store,no-cache');
      expect(response.headers.pragma).toBe('no-cache');
      expect(response.body).toMatchObject(NOT_FOUND);
    });
  });

  describe('legacy redirects', () => {
    it.each([
      ['/public/widget/dev-test-masjid', `${PUBLIC_BASE_URL}/w/dev-test-masjid`],
      ['/public/widget/dev-test-masjid/daily', `${PUBLIC_BASE_URL}/w/dev-test-masjid/daily`],
      ['/public/widget/dev-test-masjid/jumuah', `${PUBLIC_BASE_URL}/w/dev-test-masjid/jumuah`],
      ['/public/tv/dev-test-masjid', `${PUBLIC_BASE_URL}/tv/dev-test-masjid`],
      ['/public/widget/a%20b', `${PUBLIC_BASE_URL}/w/a b`],
      ['/public/tv/a%2Fb%3Fc', `${PUBLIC_BASE_URL}/tv/a%2Fb%3Fc`],
      ['/public/tv/a%09b%7Fc', `${PUBLIC_BASE_URL}/tv/a%09b%7Fc`],
      ['/public/widget/a%22b%3Cc%3E', `${PUBLIC_BASE_URL}/w/a"b<c>`],
      ['/clock?masjid=abc', `${PUBLIC_BASE_URL}/tv/abc`],
      ['/clock?masjid=a+b&masjid=c', `${PUBLIC_BASE_URL}/tv/a b`],
      ['/iqama-widget.php?x?my-slug', `${PUBLIC_BASE_URL}/w/my-slug`],
      ['/iqama-widget.php?a=1&b=2?slug?extra', `${PUBLIC_BASE_URL}/w/slug`],
      ['/iqama-widget.php?x?my%20slug', `${PUBLIC_BASE_URL}/w/my%2520slug`],
      ['/iqama-widget.php?masjid=abc', `${PUBLIC_BASE_URL}/w/abc`],
      ['/iqama-widget2.php?masjid=abc', `${PUBLIC_BASE_URL}/w2/abc`],
      ['/IQAMA-WIDGET2.PHP?x?abc', `${PUBLIC_BASE_URL}/w2/abc`],
      ['/iqama-widget2.php?x?abc', `${PUBLIC_BASE_URL}/w2/abc`],
    ])('GET %s redirects to %s', async (path, location) => {
      const { http } = await start(emptyState({ organization: null }));
      const response = await http().get(path).redirects(0);
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(location);
      expect(response.text).toBe('');
    });

    it('fails like Kestrel when the redirect target would carry non-ASCII characters', async () => {
      const { http } = await start(emptyState());
      for (const path of ['/public/tv/caf%C3%A9', '/public/widget/%C3%BF', '/clock?masjid=%C4%80']) {
        const response = await http().get(path);
        expect(response.status, path).toBe(500);
        expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
        expect(response.headers.location).toBeUndefined();
      }
    });

    it('requires the masjid query parameter for /clock', async () => {
      const { http } = await start(emptyState());
      for (const path of ['/clock', '/clock?masjid=', '/clock?masjid=%20%20']) {
        const response = await http().get(path);
        expect(response.status, path).toBe(400);
        expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
        expect(response.body).toMatchObject({ title: 'One or more validation errors occurred.', status: 400, errors: { masjid: ['The masjid field is required.'] } });
      }
    });

    it('rejects legacy widget requests without a slug', async () => {
      const { http } = await start(emptyState());
      for (const path of ['/iqama-widget.php', '/iqama-widget2.php', '/iqama-widget.php??slug', '/iqama-widget.php?masjid=%20', '/iqama-widget2.php?x=1']) {
        const response = await http().get(path);
        expect(response.status, path).toBe(400);
        expect(response.headers['content-type']).toMatch(/^text\/plain/);
        expect(response.text).toBe('Missing organization slug');
      }
    });

    it('derives the origin from the forwarded headers or the request outside a configured base URL', async () => {
      const testing = await start(emptyState(), { publicBaseUrl: null });
      const forwarded = await testing.http().get('/public/widget/slug').set('X-Forwarded-Proto', 'http').set('X-Forwarded-Host', 'iqamatime.com, internal');
      expect(forwarded.status).toBe(302);
      expect(forwarded.headers.location).toBe('https://iqamatime.com/w/slug');
      const withPort = await testing.http().get('/public/tv/slug').set('Host', 'iqamatime.com:8443');
      expect(withPort.headers.location).toBe('https://iqamatime.com:8443/tv/slug');
      const loopback = await testing.http().get('/public/widget/slug');
      expect(loopback.status).toBe(500);
      expect(loopback.headers['content-type']).toMatch(/^application\/problem\+json/);

      const development = await start(emptyState(), { publicBaseUrl: null, environmentName: 'Development' });
      const local = await development.http().get('/public/widget/slug').set('Host', 'localhost:3000');
      expect(local.status).toBe(302);
      expect(local.headers.location).toBe('http://localhost:3000/w/slug');
    });
  });
});
