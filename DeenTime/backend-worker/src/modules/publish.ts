import { authorize, authorizeRoles, canAccessOrganization } from '../core/auth.js';
import { config, currentUser, db, type App, type Ctx } from '../core/context.js';
import { fromDbBool, fromJsonArray, newId, normalizeId, now } from '../core/db.js';
import { forbidden, notFound, validationProblem } from '../core/errors.js';
import { dateOnlyFromDb, dateOnlyToDb, EMPTY_GUID, enumToDb, isGuid, parseSalah, PDF_ORIENTATIONS, PDF_SIZES, timeOnlyFromDb, type PdfOrientation, type PdfSize } from '../core/json.js';
import { rateLimit } from '../core/rate-limit.js';
import { parseBody } from '../core/validation.js';
import { requestOrigin, storage } from '../integrations/storage.js';
import { CRITERIA_COLUMNS, criteriaRowToCalculatorInput, HIJRI_MAP_COLUMNS, hijriAnchorFromRow, type CriteriaDbRow, type HijriMapDbRow } from './public/shared.js';
import { buildEmbedCode, resolvePublicOrigin } from './publish/embed-code.js';
import {
  hijriAnchorsFromMaps,
  MISSING_CRITERIA_MESSAGE,
  monthlyPeriod,
  ramadanPeriod,
  renderSchedulePdf,
  type PdfIqamaEntry,
  type SchedulePeriod,
} from './publish/pdf-generator.js';
import { TV_DISPLAY_CONFIG_DEFAULTS, toPublishArtifactJson, toTvDisplayConfigJson, tvDisplayConfigValues, type PublishArtifactRow, type TvDisplayConfigRow } from './publish/publish.mapper.js';
import { pdfGenerateSchema, ramadanPdfGenerateSchema, tvConfigUpdateSchema } from './publish/publish.schemas.js';

interface TvConfigDbRow {
  Id: string;
  OrganizationId: string;
  ShowSeconds: number;
  ShowHijri: number;
  AccentColor: string;
  ClockFontScale: number;
  AutoRefreshSeconds: number;
}

interface ArtifactDbRow {
  Id: string;
  OrganizationId: string;
  Year: number;
  Month: number;
  Size: number;
  Orientation: number;
  StorageUrl: string;
  CreatedAtUtc: string;
}

/** The organization with its criteria and design (each optional), as one joined row. */
interface PdfOrganizationRow extends Partial<CriteriaDbRow> {
  Name: string;
  AddressLine: string | null;
  City: string | null;
  State: string | null;
  OrgZipCode: string | null;
  Phone: string | null;
  Email: string | null;
  WebsiteUrl: string | null;
  CriteriaId: string | null;
  DesignId: string | null;
  IqamaHeadings: string | null;
  FooterHtml: string | null;
}

const TV_CONFIG_COLUMNS = '"Id", "OrganizationId", "ShowSeconds", "ShowHijri", "AccentColor", "ClockFontScale", "AutoRefreshSeconds"';
const ARTIFACT_COLUMNS = '"Id", "OrganizationId", "Year", "Month", "Size", "Orientation", "StorageUrl", "CreatedAtUtc"';

const PDF_ORGANIZATION_SQL = `SELECT o."Name", o."AddressLine", o."City", o."State", o."ZipCode" AS "OrgZipCode", o."Phone", o."Email", o."WebsiteUrl",
  c."Id" AS "CriteriaId", ${CRITERIA_COLUMNS.split(', ')
    .map((column) => `c.${column}`)
    .join(', ')},
  d."Id" AS "DesignId", d."IqamaHeadings", d."FooterHtml"
FROM "Organizations" o
LEFT JOIN "PrayerTimingCriteria" c ON c."OrganizationId" = o."Id"
LEFT JOIN "DesignSettings" d ON d."OrganizationId" = o."Id"
WHERE o."Id" = ?
LIMIT 1`;

/** {orgId:guid} route constraint: anything else is 404, and Guid.ToString() is lower-case. */
function routeGuid(value: string): string {
  if (!isGuid(value)) throw notFound();
  return value.toLowerCase();
}

/**
 * ListArtifacts([FromQuery] Guid orgId, [FromQuery] int year) model binding: a missing value
 * is the type's default, an empty or unparsable one is a 400 ValidationProblemDetails.
 */
function bindArtifactsQuery(orgId: string | undefined, year: string | undefined): { organizationId: string; year: number } {
  const errors: Record<string, string[]> = {};
  let organizationId = EMPTY_GUID;
  if (orgId !== undefined) {
    if (orgId.trim() === '') errors.orgId = [`The value '${orgId}' is invalid.`];
    else if (isGuid(orgId.trim())) organizationId = orgId.trim().toLowerCase();
    else errors.orgId = [`The value '${orgId}' is not valid.`];
  }
  let yearNumber = 0;
  if (year !== undefined) {
    const parsed = /^\s*[+-]?\d+\s*$/.test(year) ? Number(year) : Number.NaN;
    if (year.trim() === '') errors.year = [`The value '${year}' is invalid.`];
    else if (Number.isInteger(parsed) && parsed >= -2_147_483_648 && parsed <= 2_147_483_647) yearNumber = parsed;
    else errors.year = [`The value '${year}' is not valid.`];
  }
  if (Object.keys(errors).length > 0) throw validationProblem(errors);
  return { organizationId, year: yearNumber };
}

function tvConfigFromDb(row: TvConfigDbRow): TvDisplayConfigRow {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    showSeconds: fromDbBool(row.ShowSeconds),
    showHijri: fromDbBool(row.ShowHijri),
    accentColor: row.AccentColor,
    clockFontScale: row.ClockFontScale,
    autoRefreshSeconds: row.AutoRefreshSeconds,
  };
}

function artifactFromDb(row: ArtifactDbRow): PublishArtifactRow {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    year: row.Year,
    month: row.Month,
    size: row.Size,
    orientation: row.Orientation,
    storageUrl: row.StorageUrl,
    createdAtUtc: row.CreatedAtUtc,
  };
}

/**
 * PdfGeneratorService: reads the organization, its Iqama history and its Hijri month maps
 * in ONE D1 batch and renders the schedule. `period` is either the period itself (monthly)
 * or, for Ramadan, the Gregorian year whose period is derived from that year's month maps.
 * Failures are plain Errors, i.e. the 500 problem, as in backend-node.
 */
async function generateSchedulePdf(c: Ctx, organizationId: string, period: SchedulePeriod | { ramadanYear: number }, size: PdfSize, orientation: PdfOrientation): Promise<Uint8Array> {
  let firstYear: number;
  let lastYear: number;
  let lastDate: string;
  if ('ramadanYear' in period) {
    // Ramadan's dates all lie in the requested Gregorian year.
    firstYear = lastYear = period.ramadanYear;
    lastDate = `${String(period.ramadanYear).padStart(4, '0')}-12-31`;
  } else {
    const times = period.dates.map((date) => date.getTime());
    const end = new Date(Math.max(...times));
    firstYear = new Date(Math.min(...times)).getUTCFullYear();
    lastYear = end.getUTCFullYear();
    lastDate = dateOnlyToDb(end);
  }

  const database = db(c);
  const [organizations, iqama, maps] = await database.batch([
    database.stmt(PDF_ORGANIZATION_SQL, organizationId),
    database.stmt('SELECT "Date", "Salah", "Time", "OffsetMinutes" FROM "IqamaEntries" WHERE "OrganizationId" = ? AND "Date" <= ? ORDER BY "Date" ASC', organizationId, lastDate),
    database.stmt(`SELECT ${HIJRI_MAP_COLUMNS} FROM "HijriMonthMaps" WHERE "OrganizationId" = ? AND "Year" >= ? AND "Year" <= ?`, organizationId, firstYear, lastYear),
  ]);

  const hijriAnchors = hijriAnchorsFromMaps((maps.results as HijriMapDbRow[]).map(hijriAnchorFromRow));
  const schedulePeriod = 'ramadanYear' in period ? ramadanPeriod(period.ramadanYear, hijriAnchors) : period;
  const organization = (organizations.results as PdfOrganizationRow[])[0];
  if (!organization) throw new Error('Sequence contains no elements.');
  if (organization.CriteriaId === null) throw new Error(MISSING_CRITERIA_MESSAGE);

  return renderSchedulePdf({
    organization: {
      name: organization.Name,
      addressLine: organization.AddressLine,
      city: organization.City,
      state: organization.State,
      zipCode: organization.OrgZipCode,
      phone: organization.Phone,
      email: organization.Email,
      websiteUrl: organization.WebsiteUrl,
    },
    design: organization.DesignId === null ? null : { iqamaHeadings: fromJsonArray(organization.IqamaHeadings), footerHtml: organization.FooterHtml },
    criteria: criteriaRowToCalculatorInput(organization as CriteriaDbRow),
    iqamaEntries: (iqama.results as { Date: string; Salah: number; Time: string; OffsetMinutes: number | null }[]).flatMap((row): PdfIqamaEntry[] => {
      const salah = parseSalah(row.Salah);
      return salah === null ? [] : [{ date: dateOnlyFromDb(row.Date), salah, time: timeOnlyFromDb(row.Time), offsetMinutes: row.OffsetMinutes }];
    }),
    hijriAnchors,
    period: schedulePeriod,
    size,
    orientation,
  });
}

/** UploadAsync + the PublishArtifact row (enums stored as their integer values). */
async function storeArtifact(c: Ctx, key: string, bytes: Uint8Array, organizationId: string, year: number, month: number, size: PdfSize, orientation: PdfOrientation): Promise<Response> {
  const storageUrl = await storage(c).upload(key, 'application/pdf', bytes, requestOrigin(c));
  const row: ArtifactDbRow = {
    Id: newId(),
    OrganizationId: organizationId,
    Year: year,
    Month: month,
    Size: enumToDb(PDF_SIZES, size),
    Orientation: enumToDb(PDF_ORIENTATIONS, orientation),
    StorageUrl: storageUrl,
    CreatedAtUtc: now(),
  };
  await db(c).run(
    `INSERT INTO "PublishArtifacts" (${ARTIFACT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.Id,
    row.OrganizationId,
    row.Year,
    row.Month,
    row.Size,
    row.Orientation,
    row.StorageUrl,
    row.CreatedAtUtc,
  );
  return c.json(toPublishArtifactJson(artifactFromDb(row)));
}

/**
 * /api/v1/publish: embed code, TV display configuration, PDF artifacts.
 * Port of backend-node/src/modules/publish/publish.controller.ts (class-level @Authorize()).
 */
export function register(app: App): void {
  app.get('/api/v1/publish/embed-code/:orgId', authorize(), async (c) => {
    const organizationId = routeGuid(c.req.param('orgId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    const organization = await db(c).first<{ Slug: string; Name: string }>('SELECT "Slug", "Name" FROM "Organizations" WHERE "Id" = ?', organizationId);
    if (!organization) throw notFound();
    // [FromQuery] string: the first value of a repeated query key.
    const origin = resolvePublicOrigin(c.req.queries('publicOrigin')?.[0], config(c).get('Frontend:PublicBaseUrl'), config(c).isDevelopment());
    return c.json(buildEmbedCode(origin, { slug: organization.Slug, name: organization.Name }));
  });

  app.get('/api/v1/publish/tv-config/:orgId', authorize(), async (c) => {
    const organizationId = routeGuid(c.req.param('orgId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    const stored = await db(c).first<TvConfigDbRow>(`SELECT ${TV_CONFIG_COLUMNS} FROM "TvDisplayConfigs" WHERE "OrganizationId" = ?`, organizationId);
    return c.json(toTvDisplayConfigJson(stored ? tvConfigFromDb(stored) : { id: newId(), organizationId, ...TV_DISPLAY_CONFIG_DEFAULTS }));
  });

  app.put('/api/v1/publish/tv-config/:orgId', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    // The validation pipe runs before the handler body, so a bad body is 400 even for an unknown organization.
    const req = await parseBody(c, tvConfigUpdateSchema);
    const organizationId = routeGuid(c.req.param('orgId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    const values = tvDisplayConfigValues(req);
    // Prisma upsert on the unique OrganizationId, as one statement.
    const saved = await db(c).first<TvConfigDbRow>(
      `INSERT INTO "TvDisplayConfigs" (${TV_CONFIG_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("OrganizationId") DO UPDATE SET "ShowSeconds" = excluded."ShowSeconds", "ShowHijri" = excluded."ShowHijri", "AccentColor" = excluded."AccentColor",
         "ClockFontScale" = excluded."ClockFontScale", "AutoRefreshSeconds" = excluded."AutoRefreshSeconds"
       RETURNING ${TV_CONFIG_COLUMNS}`,
      newId(),
      organizationId,
      values.showSeconds,
      values.showHijri,
      values.accentColor,
      values.clockFontScale,
      values.autoRefreshSeconds,
    );
    if (!saved) throw new Error('The TV display configuration could not be saved.');
    return c.json(toTvDisplayConfigJson(tvConfigFromDb(saved)));
  });

  app.post('/api/v1/publish/pdf/generate', rateLimit('expensive'), authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, pdfGenerateSchema);
    if (!canAccessOrganization(currentUser(c), req.orgId)) throw forbidden();
    const organizationId = normalizeId(req.orgId);
    const bytes = await generateSchedulePdf(c, organizationId, monthlyPeriod(req.year, req.month), req.size, req.orientation);
    const key = `artifacts/${organizationId}/${req.year}-${req.month}-${newId()}.pdf`;
    return storeArtifact(c, key, bytes, organizationId, req.year, req.month, req.size, req.orientation);
  });

  app.post('/api/v1/publish/pdf/ramadan', rateLimit('expensive'), authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, ramadanPdfGenerateSchema);
    if (!canAccessOrganization(currentUser(c), req.orgId)) throw forbidden();
    const organizationId = normalizeId(req.orgId);
    const bytes = await generateSchedulePdf(c, organizationId, { ramadanYear: req.year }, req.size, req.orientation);
    const key = `artifacts/${organizationId}/ramadan-${req.year}-${req.size}-${newId()}.pdf`;
    return storeArtifact(c, key, bytes, organizationId, req.year, 0, req.size, req.orientation);
  });

  app.get('/api/v1/publish/artifacts', authorize(), async (c) => {
    const query = bindArtifactsQuery(c.req.queries('orgId')?.[0], c.req.queries('year')?.[0]);
    if (!canAccessOrganization(currentUser(c), query.organizationId)) throw forbidden();
    const rows = await db(c).all<ArtifactDbRow>(
      `SELECT ${ARTIFACT_COLUMNS} FROM "PublishArtifacts" WHERE "OrganizationId" = ? AND "Year" = ? ORDER BY "CreatedAtUtc" DESC`,
      query.organizationId,
      query.year,
    );
    return c.json(rows.map((row) => toPublishArtifactJson(artifactFromDb(row))));
  });

  app.get('/api/v1/publish/pdf/:artifactId', authorize(), async (c) => {
    const artifactId = c.req.param('artifactId');
    const artifact = isGuid(artifactId)
      ? await db(c).first<{ OrganizationId: string; StorageUrl: string }>('SELECT "OrganizationId", "StorageUrl" FROM "PublishArtifacts" WHERE "Id" = ?', normalizeId(artifactId))
      : null;
    if (!artifact) throw notFound();
    if (!canAccessOrganization(currentUser(c), artifact.OrganizationId)) throw forbidden();
    // Redirect(url): 302 with the stored URL as-is and no body.
    return c.body(null, 302, { Location: artifact.StorageUrl });
  });
}
