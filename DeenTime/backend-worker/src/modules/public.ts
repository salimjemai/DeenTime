import { config, db, type App, type Ctx } from '../core/context.js';
import { fromDbBool, fromJsonArray } from '../core/db.js';
import { badRequestText, modelValidationProblem, problem } from '../core/errors.js';
import { renderError } from '../core/http.js';
import { addDays, dateOnlyFromDb, dateOnlyToDb, formatDateOnly, utcToday } from '../core/json.js';
import { rateLimit } from '../core/rate-limit.js';
import { buildHijriDisplay } from '../domain/hijri.js';
import { computePrayerTimes, toPrayerTimesDto } from '../domain/prayer-times.js';
import { todayInZone } from '../domain/timezone.js';
import {
  absoluteRoute,
  dotnetTicks,
  escapeDataString,
  redirectToFrontend,
  resolvePublicOrigin,
  versionedAssetUrl,
  type PublicOriginRequest,
} from './public/public-origin.js';
import {
  bindQueryString,
  buildDisplayDesign,
  buildIqamaItems,
  buildTvConfig,
  iframe,
  legacySlug,
  parseDisplayParameters,
  queryValues,
  queryValueToString,
  SUPPORTED_LAYOUTS,
  SUPPORTED_THEMES,
  webUtilityHtmlEncode,
  type DisplayIqamaSource,
} from './public/public.mapper.js';
import { CRITERIA_COLUMNS, criteriaRowToCalculatorInput, HIJRI_MAP_COLUMNS, hijriAnchorFromRow, type CriteriaDbRow, type HijriMapDbRow } from './public/shared.js';

/** The organization with its criteria, design and TV configuration (each optional), as one joined row. */
interface DisplayRow extends Partial<CriteriaDbRow> {
  Id: string;
  Name: string;
  Slug: string;
  AddressLine: string | null;
  City: string | null;
  State: string | null;
  CriteriaId: string | null;
  DesignId: string | null;
  HeaderImageUrl: string | null;
  IqamaHeadings: string | null;
  FooterHtml: string | null;
  Theme: string | null;
  DesignUpdatedAtUtc: string | null;
  TvFontScale: number | null;
  WidgetFontScale: number | null;
  CompactFontScale: number | null;
  TvFontFamily: string | null;
  WidgetFontFamily: string | null;
  CompactFontFamily: string | null;
  TvConfigId: string | null;
  ShowSeconds: number | null;
  ShowHijri: number | null;
  AccentColor: string | null;
  ClockFontScale: number | null;
  AutoRefreshSeconds: number | null;
}

interface IqamaDbRow {
  Salah: number;
  Date: string;
  Time: string;
  OffsetMinutes: number | null;
  Note: string | null;
  UpdatedAtUtc: string;
}

interface ArtifactDbRow {
  StorageUrl: string;
}

const ORGANIZATION_BY_SLUG = '(SELECT "Id" FROM "Organizations" WHERE "Slug" = ?)';

const DISPLAY_SQL = `SELECT o."Id", o."Name", o."Slug", o."AddressLine", o."City", o."State",
  c."Id" AS "CriteriaId", ${CRITERIA_COLUMNS.split(', ')
    .map((column) => `c.${column}`)
    .join(', ')},
  d."Id" AS "DesignId", d."HeaderImageUrl", d."IqamaHeadings", d."FooterHtml", d."Theme", d."UpdatedAtUtc" AS "DesignUpdatedAtUtc",
  d."TvFontScale", d."WidgetFontScale", d."CompactFontScale", d."TvFontFamily", d."WidgetFontFamily", d."CompactFontFamily",
  t."Id" AS "TvConfigId", t."ShowSeconds", t."ShowHijri", t."AccentColor", t."ClockFontScale", t."AutoRefreshSeconds"
FROM "Organizations" o
LEFT JOIN "PrayerTimingCriteria" c ON c."OrganizationId" = o."Id"
LEFT JOIN "DesignSettings" d ON d."OrganizationId" = o."Id"
LEFT JOIN "TvDisplayConfigs" t ON t."OrganizationId" = o."Id"
WHERE o."Slug" = ?
LIMIT 1`;

/**
 * The entries that can be "the latest per Salah on or before today" for any local date
 * between the two bound dates: every entry dated up to the later one that is not older
 * than its Salah's newest entry on or before the earlier one.
 */
const IQAMA_SQL = `SELECT e."Salah", e."Date", e."Time", e."OffsetMinutes", e."Note", e."UpdatedAtUtc"
FROM "IqamaEntries" e
WHERE e."OrganizationId" = ${ORGANIZATION_BY_SLUG} AND e."Date" <= ?
  AND e."Date" >= COALESCE((SELECT MAX(x."Date") FROM "IqamaEntries" x WHERE x."OrganizationId" = e."OrganizationId" AND x."Salah" = e."Salah" AND x."Date" <= ?), '')`;

const HIJRI_SQL = `SELECT ${HIJRI_MAP_COLUMNS} FROM "HijriMonthMaps" WHERE "OrganizationId" = ${ORGANIZATION_BY_SLUG} AND "Year" = ? AND "Month" = ? LIMIT 1`;

const ARTIFACT_SQL = `SELECT "StorageUrl" FROM "PublishArtifacts" WHERE "OrganizationId" = ${ORGANIZATION_BY_SLUG} AND "Year" = ? AND "Month" = ? ORDER BY "CreatedAtUtc" DESC LIMIT 1`;

/** The parts of the request PublicOrigin() reads (Request.Scheme and the Host / X-Forwarded-* headers). */
function originRequest(c: Ctx): PublicOriginRequest {
  const url = new URL(c.req.url);
  return {
    protocol: url.protocol.replace(':', ''),
    header: (name) => c.req.header(name) ?? (name.toLowerCase() === 'host' ? url.host : undefined),
  };
}

/** 302 to the frontend route, with an empty body. */
function frontendRedirect(c: Ctx, path: string): Response {
  return c.body(null, 302, { Location: redirectToFrontend(config(c), originRequest(c), path) });
}

/**
 * /public (display, displays, widget, tv) and the legacy redirects /clock, /iqama-widget.php, /iqama-widget2.php.
 * Port of backend-node/src/modules/public/public.controller.ts and legacy-redirect.controller.ts
 * (anonymous, "public" rate-limit policy).
 */
export function register(app: App): void {
  /**
   * The hottest route of the API (TV screens and widgets poll it): everything is read in ONE
   * D1 batch. The organization's local date is only known once its time zone has been read,
   * so the date-dependent lookups are made for both ends of the possible range (UTC today
   * -1 day .. +1 day; at most two calendar months) and the matching rows are picked afterwards.
   */
  app.get('/public/display/:slug', rateLimit('public'), async (c) => {
    const parameters = parseDisplayParameters(c.req.queries());
    const slug = c.req.param('slug');

    const utc = utcToday();
    const earliest = addDays(utc, -1);
    const latest = addDays(utc, 1);
    const months = [earliest, latest]
      .map((date) => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }))
      .filter((item, index, all) => index === 0 || item.month !== all[0].month || item.year !== all[0].year);

    const database = db(c);
    const results = await database.batch([
      database.stmt(DISPLAY_SQL, slug),
      database.stmt(IQAMA_SQL, slug, dateOnlyToDb(latest), dateOnlyToDb(earliest)),
      ...months.map(({ year, month }) => database.stmt(HIJRI_SQL, slug, year, month)),
      ...months.map(({ year, month }) => database.stmt(ARTIFACT_SQL, slug, year, month)),
    ]);
    const org = (results[0].results as DisplayRow[])[0];
    if (!org) throw problem(404);

    const hasCriteria = org.CriteriaId !== null;
    const timezoneId = hasCriteria ? (org.TimezoneId as string) : 'UTC';
    const date = todayInZone(timezoneId);
    const times = hasCriteria ? computePrayerTimes(criteriaRowToCalculatorInput(org as CriteriaDbRow), date) : null;
    const today = dateOnlyToDb(date);
    const monthIndex = months.findIndex(({ year, month }) => year === date.getUTCFullYear() && month === date.getUTCMonth() + 1);

    const history = (results[1].results as IqamaDbRow[])
      .filter((row) => row.Date <= today)
      .map(
        (row): DisplayIqamaSource => ({
          salah: row.Salah,
          date: dateOnlyFromDb(row.Date),
          time: row.Time,
          offsetMinutes: row.OffsetMinutes,
          note: row.Note,
          updatedAtUtc: new Date(row.UpdatedAtUtc),
        }),
      );
    const hijriRow = monthIndex < 0 ? undefined : (results[2 + monthIndex].results as HijriMapDbRow[])[0];
    const artifact = monthIndex < 0 ? undefined : (results[2 + months.length + monthIndex].results as ArtifactDbRow[])[0];

    const hasDesign = org.DesignId !== null;
    const tvConfig =
      org.TvConfigId === null
        ? null
        : {
            showSeconds: fromDbBool(org.ShowSeconds),
            showHijri: fromDbBool(org.ShowHijri),
            accentColor: org.AccentColor as string,
            clockFontScale: org.ClockFontScale as number,
            autoRefreshSeconds: org.AutoRefreshSeconds as number,
          };

    // PublicOrigin() is only consulted for a relative header image, exactly like VersionedAssetUrl.
    let origin: URL | null = null;
    const publicOrigin = (): URL => (origin ??= resolvePublicOrigin(config(c), originRequest(c)));
    const headerImage = org.HeaderImageUrl;
    const headerImageUrl =
      hasDesign && headerImage !== null && headerImage.trim() !== '' ? versionedAssetUrl(headerImage, dotnetTicks(new Date(org.DesignUpdatedAtUtc as string)), publicOrigin) : null;

    return c.json({
      organization: { name: org.Name, slug: org.Slug, addressLine: org.AddressLine, city: org.City, state: org.State },
      date: formatDateOnly(date),
      timezoneId,
      timings: times === null ? null : toPrayerTimesDto(times),
      iqama: buildIqamaItems(history, times, hasCriteria ? (org.KhutbahTimeMinutes as number) : 30),
      monthlyPdfUrl: artifact?.StorageUrl ?? null,
      design: buildDisplayDesign(
        hasDesign
          ? {
              headerImageUrl: org.HeaderImageUrl,
              iqamaHeadings: fromJsonArray(org.IqamaHeadings),
              footerHtml: org.FooterHtml,
              theme: org.Theme as string,
              tvFontScale: org.TvFontScale as number,
              widgetFontScale: org.WidgetFontScale as number,
              compactFontScale: org.CompactFontScale as number,
              tvFontFamily: org.TvFontFamily as string,
              widgetFontFamily: org.WidgetFontFamily as string,
              compactFontFamily: org.CompactFontFamily as string,
            }
          : null,
        parameters,
        headerImageUrl,
      ),
      hijri: buildHijriDisplay(date, hijriRow ? hijriAnchorFromRow(hijriRow) : null),
      tvConfig: buildTvConfig(tvConfig),
    });
  });

  app.get('/public/organizations/:slug/displays', rateLimit('public'), async (c) => {
    // [ResponseCache(NoStore = true, Location = None)] runs before the action, so every outcome carries these.
    const noStore = (response: Response): Response => {
      response.headers.set('Cache-Control', 'no-store,no-cache');
      response.headers.set('Pragma', 'no-cache');
      return response;
    };
    try {
      const org = await db(c).first<{ Name: string; Slug: string }>('SELECT "Name", "Slug" FROM "Organizations" WHERE "Slug" = ?', c.req.param('slug'));
      if (!org) throw problem(404);

      const origin = resolvePublicOrigin(config(c), originRequest(c));
      const escapedSlug = escapeDataString(org.Slug);
      const tvUrl = absoluteRoute(origin, `/tv/${escapedSlug}`);
      const widgetUrl = absoluteRoute(origin, `/w/${escapedSlug}`);
      const dailyWidgetUrl = absoluteRoute(origin, `/w/${escapedSlug}/daily`);
      const jumuahWidgetUrl = absoluteRoute(origin, `/w/${escapedSlug}/jumuah`);
      const compactUrl = absoluteRoute(origin, `/w2/${escapedSlug}`);
      const encodedTitle = webUtilityHtmlEncode(`MasjidHub · ${org.Name} prayer times`);

      return noStore(
        c.json({
          organization: { name: org.Name, slug: org.Slug },
          displays: {
            tv: { url: tvUrl, iframe: iframe(tvUrl, encodedTitle, '100%', '720', false) },
            widget: { url: widgetUrl, iframe: iframe(widgetUrl, encodedTitle, '390', '920', true) },
            combined: { url: widgetUrl, iframe: iframe(widgetUrl, encodedTitle, '390', '920', true) },
            daily: { url: dailyWidgetUrl, iframe: iframe(dailyWidgetUrl, webUtilityHtmlEncode(`MasjidHub · ${org.Name} daily prayer times`), '390', '720', true) },
            jumuah: { url: jumuahWidgetUrl, iframe: iframe(jumuahWidgetUrl, webUtilityHtmlEncode(`MasjidHub · ${org.Name} Friday prayer times`), '390', '560', true) },
            compact: { url: compactUrl, iframe: iframe(compactUrl, encodedTitle, '330', '820', true) },
          },
          supportedParameters: {
            locale: ['en-US', 'ar', 'ur'],
            theme: [...SUPPORTED_THEMES],
            fontScale: { min: 75, max: 160, step: 5 },
            layout: [...SUPPORTED_LAYOUTS],
          },
          defaults: { theme: 'default', fontScale: 100, locale: 'en-US' },
          provider: 'MasjidHub',
        }),
      );
    } catch (error) {
      return noStore(renderError(error, c));
    }
  });

  app.get('/public/widget/:slug', rateLimit('public'), (c) => frontendRedirect(c, `/w/${escapeDataString(c.req.param('slug'))}`));
  app.get('/public/widget/:slug/daily', rateLimit('public'), (c) => frontendRedirect(c, `/w/${escapeDataString(c.req.param('slug'))}/daily`));
  app.get('/public/widget/:slug/jumuah', rateLimit('public'), (c) => frontendRedirect(c, `/w/${escapeDataString(c.req.param('slug'))}/jumuah`));
  app.get('/public/tv/:slug', rateLimit('public'), (c) => frontendRedirect(c, `/tv/${escapeDataString(c.req.param('slug'))}`));

  // Permanent homes of the pre-IqamaTime embed URLs (legacy-redirect.controller.ts).

  /** `string masjid` is non-nullable, so a missing or blank value is a ModelState error. */
  app.get('/clock', rateLimit('public'), (c) => {
    const masjid = bindQueryString(queryValues(c.req.queries(), 'masjid'));
    if (masjid === undefined) throw modelValidationProblem({ masjid: ['The masjid field is required.'] });
    return frontendRedirect(c, `/tv/${escapeDataString(masjid)}`);
  });

  const legacyWidget =
    (compact: boolean) =>
    (c: Ctx): Response => {
      // The raw query string, still percent-encoded: the historical form is "?...?slug".
      const separator = c.req.url.indexOf('?');
      const rawQueryString = separator < 0 ? '' : c.req.url.slice(separator);
      const slug = legacySlug(rawQueryString, queryValueToString(queryValues(c.req.queries(), 'masjid')));
      if (slug.trim() === '') throw badRequestText('Missing organization slug');
      return frontendRedirect(c, `/${compact ? 'w2' : 'w'}/${escapeDataString(slug)}`);
    };
  app.get('/iqama-widget.php', rateLimit('public'), legacyWidget(false));
  app.get('/iqama-widget2.php', rateLimit('public'), legacyWidget(true));
}
