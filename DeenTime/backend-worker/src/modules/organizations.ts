import { authorize, authorizeRoles, canAccessOrganization, isSuperUser } from '../core/auth.js';
import { config, currentUser, db, type App } from '../core/context.js';
import { isUniqueViolation, newId, normalizeId, now, type SqlParam } from '../core/db.js';
import { conflict, forbidden, notFound, problem, validationProblem } from '../core/errors.js';
import { empty } from '../core/http.js';
import { dateOnlyToDb, formatDateOnly, isGuid, salahFromDb, utcToday } from '../core/json.js';
import { pagedResult } from '../core/paged-result.js';
import { parseBody } from '../core/validation.js';
import { normalizeWords, tryCreateIdentity } from '../domain/registration-identity.js';
import { ProviderUnavailableError } from '../integrations/errors.js';
import { PostalCodeService, postalCodeService, type PostalCodeLocation } from '../integrations/postal-code.js';
import { toCriteriaJson, toOrganizationJson } from './organizations/organization.mapper.js';
import { criteriaFromDb, organizationFromDb, type CriteriaDbRow, type OrganizationDbRow } from './organizations/organization.rows.js';
import { criteriaSchema, organizationUpdateSchema } from './organizations/organizations.schemas.js';

const PAGE_SIZE = 20;

/**
 * /api/v1/orgs: organizations, prayer timing criteria, readiness.
 * Port of backend-node/src/modules/organizations/organizations.controller.ts.
 */
export function register(app: App): void {
  app.get('/api/v1/orgs', authorize(), async (c) => {
    const user = currentUser(c);
    const conditions: string[] = [];
    const params: SqlParam[] = [];
    if (!isSuperUser(user)) {
      if (!user?.orgId || !isGuid(user.orgId)) throw forbidden();
      conditions.push('"Id" = ?');
      params.push(normalizeId(user.orgId));
    }
    const search = c.req.query('search');
    if (search?.trim()) {
      // Prisma `contains` + `mode: 'insensitive'`: ILIKE '%search%' with the wildcards escaped.
      conditions.push('instr(LOWER("Name"), LOWER(?)) > 0');
      params.push(search);
    }
    let pageNumber = Number.parseInt(c.req.query('page') ?? '', 10);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) pageNumber = 1;
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [count, page] = await db(c).batch([
      db(c).stmt(`SELECT COUNT(*) AS "Total" FROM "Organizations"${where}`, ...params),
      db(c).stmt(
        `SELECT * FROM "Organizations"${where} ORDER BY "Name" COLLATE NOCASE, "Name", "Id" LIMIT ? OFFSET ?`,
        ...params,
        PAGE_SIZE,
        (pageNumber - 1) * PAGE_SIZE,
      ),
    ]);
    const total = Number((count.results as { Total: number }[])[0]?.Total ?? 0);
    const items = (page.results as OrganizationDbRow[]).map((row) => toOrganizationJson(organizationFromDb(row)));
    return c.json(pagedResult(items, pageNumber, PAGE_SIZE, total));
  });

  app.get('/api/v1/orgs/:idOrSlug', authorize(), async (c) => {
    const idOrSlug = c.req.param('idOrSlug');
    const byId = isGuid(idOrSlug);
    const key = byId ? normalizeId(idOrSlug) : idOrSlug;
    const [organizations, criteria] = await db(c).batch([
      db(c).stmt(`SELECT * FROM "Organizations" WHERE ${byId ? '"Id"' : '"Slug"'} = ?`, key),
      db(c).stmt(
        byId
          ? 'SELECT * FROM "PrayerTimingCriteria" WHERE "OrganizationId" = ?'
          : 'SELECT * FROM "PrayerTimingCriteria" WHERE "OrganizationId" = (SELECT "Id" FROM "Organizations" WHERE "Slug" = ?)',
        key,
      ),
    ]);
    const organization = (organizations.results as OrganizationDbRow[])[0];
    if (organization && !canAccessOrganization(currentUser(c), organization.Id)) throw forbidden();
    if (!organization) throw notFound();
    const criteriaRow = (criteria.results as CriteriaDbRow[])[0];
    return c.json(toOrganizationJson(organizationFromDb(organization), { criteria: criteriaRow ? criteriaFromDb(criteriaRow) : null }));
  });

  app.put('/api/v1/orgs/:id', authorize(), authorize('Admin'), async (c) => {
    // The body pipe runs before the handler in backend-node, so a bad body is 400 even for an unknown id.
    const input = await parseBody(c, organizationUpdateSchema);
    const id = organizationIdParam(c.req.param('id'));
    if (!canAccessOrganization(currentUser(c), id)) throw forbidden();
    const existing = await db(c).first<{ WebsiteUrl: string | null; Email: string | null }>('SELECT "WebsiteUrl", "Email" FROM "Organizations" WHERE "Id" = ?', id);
    if (!existing) throw notFound();

    const data: Record<string, SqlParam> = {
      Name: input.name,
      AddressLine: input.addressLine,
      City: input.city,
      State: input.state,
      ZipCode: input.zipCode,
      Phone: input.phone,
      Email: input.email,
      SocialUrl: input.socialUrl,
      UpdatedAtUtc: now(),
    };
    let websiteUrl = existing.WebsiteUrl;
    if (input.websiteUrl?.trim() && input.addressLine?.trim() && input.city?.trim() && input.state?.trim() && input.zipCode?.trim()) {
      const identity = tryCreateIdentity(existing.Email ?? '', input.name, input.websiteUrl, input.addressLine, input.city, input.state, input.zipCode);
      if (!identity) throw validationProblem({ WebsiteUrl: ['Enter a valid masjid website address.'] });
      data.NormalizedName = identity.name;
      data.NormalizedWebsiteHost = identity.websiteHost;
      data.AddressFingerprint = identity.addressFingerprint;
      data.MasjidIdentityKey = identity.masjidIdentityKey;
      websiteUrl = identity.websiteUrl;
    } else {
      data.NormalizedName = normalizeWords(input.name);
    }
    if (!websiteUrl?.trim()) websiteUrl = input.websiteUrl;
    data.WebsiteUrl = websiteUrl;

    const columns = Object.keys(data);
    try {
      await db(c).run(
        `UPDATE "Organizations" SET ${columns.map((column) => `"${column}" = ?`).join(', ')} WHERE "Id" = ?`,
        ...columns.map((column) => data[column]),
        id,
      );
    } catch (error) {
      // The partial unique indexes on NormalizedWebsiteHost, AddressFingerprint and MasjidIdentityKey.
      if (isUniqueViolation(error)) throw conflict({ code: 'masjid_already_registered', message: 'This masjid website or address belongs to another registration.' });
      throw error;
    }
    return empty(c, 204);
  });

  app.get('/api/v1/orgs/:id/criteria', authorize(), async (c) => {
    const id = organizationIdParam(c.req.param('id'));
    if (!canAccessOrganization(currentUser(c), id)) throw forbidden();
    const criteria = await db(c).first<CriteriaDbRow>('SELECT * FROM "PrayerTimingCriteria" WHERE "OrganizationId" = ?', id);
    if (!criteria) throw notFound();
    return c.json(toCriteriaJson(criteriaFromDb(criteria)));
  });

  app.put('/api/v1/orgs/:id/criteria', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const input = await parseBody(c, criteriaSchema);
    const id = organizationIdParam(c.req.param('id'));
    if (!canAccessOrganization(currentUser(c), id)) throw forbidden();

    let latitude = input.latitude;
    let longitude = input.longitude;
    let zipCode = input.zipCode;
    const normalized = PostalCodeService.normalizeUsPostalCode(input.zipCode);
    if (normalized) {
      let location: PostalCodeLocation | null;
      try {
        location = await postalCodeService(config(c)).resolveUs(normalized);
      } catch (error) {
        if (error instanceof ProviderUnavailableError) {
          throw problem(503, 'Postal-code lookup is temporarily unavailable.', 'Prayer criteria were not saved because the location could not be verified.');
        }
        throw error;
      }
      if (!location) throw validationProblem({ ZipCode: ['The U.S. ZIP code could not be found.'] });
      // A U.S. ZIP is the source of truth for the calculation location.
      zipCode = location.postalCode;
      latitude = location.latitude;
      longitude = location.longitude;
    }

    // findFirst + update/create in backend-node; a single upsert on the unique OrganizationId index here.
    await db(c).run(
      `INSERT INTO "PrayerTimingCriteria" ("Id", "OrganizationId", "Method", "JuristicMethodAsr", "Latitude", "Longitude", "TimezoneId", "DstObserved", "DstBegins", "DstEnds", "ZipCode", "MinutesAfterZawal", "MinutesAfterMaghrib", "KhutbahTimeMinutes", "UpdatedAtUtc")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("OrganizationId") DO UPDATE SET
         "Method" = excluded."Method", "JuristicMethodAsr" = excluded."JuristicMethodAsr", "Latitude" = excluded."Latitude", "Longitude" = excluded."Longitude",
         "TimezoneId" = excluded."TimezoneId", "DstObserved" = excluded."DstObserved", "DstBegins" = excluded."DstBegins", "DstEnds" = excluded."DstEnds",
         "ZipCode" = excluded."ZipCode", "MinutesAfterZawal" = excluded."MinutesAfterZawal", "MinutesAfterMaghrib" = excluded."MinutesAfterMaghrib",
         "KhutbahTimeMinutes" = excluded."KhutbahTimeMinutes", "UpdatedAtUtc" = excluded."UpdatedAtUtc"`,
      newId(),
      id,
      input.method,
      input.juristicMethodAsr,
      latitude,
      longitude,
      input.timezoneId,
      input.dstObserved,
      input.dstBegins ? dateOnlyToDb(input.dstBegins) : null,
      input.dstEnds ? dateOnlyToDb(input.dstEnds) : null,
      zipCode,
      input.minutesAfterZawal,
      input.minutesAfterMaghrib,
      input.khutbahTimeMinutes,
      now(),
    );
    return empty(c, 204);
  });

  app.delete('/api/v1/orgs/:id/criteria', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const id = organizationIdParam(c.req.param('id'));
    if (!canAccessOrganization(currentUser(c), id)) throw forbidden();
    await db(c).run('DELETE FROM "PrayerTimingCriteria" WHERE "OrganizationId" = ?', id);
    return empty(c, 204);
  });

  app.get('/api/v1/orgs/:id/readiness', authorize(), async (c) => {
    const id = organizationIdParam(c.req.param('id'));
    if (!canAccessOrganization(currentUser(c), id)) throw forbidden();
    const today = utcToday();
    const [organizations, salahs] = await db(c).batch([
      db(c).stmt(
        `SELECT o."Id",
                EXISTS (SELECT 1 FROM "PrayerTimingCriteria" p WHERE p."OrganizationId" = o."Id") AS "HasCriteria",
                d."Id" AS "DesignId", d."HeaderImageUrl"
           FROM "Organizations" o LEFT JOIN "DesignSettings" d ON d."OrganizationId" = o."Id"
          WHERE o."Id" = ?`,
        id,
      ),
      // latestEntriesPerSalah keeps one entry per Salah, so only which Salahs have an entry matters.
      db(c).stmt('SELECT DISTINCT "Salah" FROM "IqamaEntries" WHERE "OrganizationId" = ? AND "Date" <= ?', id, formatDateOnly(today)),
    ]);
    const organization = (organizations.results as { Id: string; HasCriteria: number; DesignId: string | null; HeaderImageUrl: string | null }[])[0];
    if (!organization) throw notFound();

    const active = (salahs.results as { Salah: number }[]).map((entry) => salahFromDb(entry.Salah));
    const activeSalahs = new Set<string>(active);
    const daily = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
    const dailyIqama = Object.fromEntries(daily.map((prayer) => [prayer, activeSalahs.has(prayer)])) as Record<string, boolean>;
    const jumuahCount = active.filter((salah) => ['Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'].includes(salah)).length;
    const hasCriteria = !!organization.HasCriteria;
    const checks = {
      criteria: hasCriteria,
      dailyIqama,
      jumuah: jumuahCount > 0,
      design: organization.DesignId !== null && !!organization.HeaderImageUrl?.trim(),
      publicPreview: hasCriteria,
    };
    return c.json({
      readyToPublish: checks.criteria && daily.every((prayer) => dailyIqama[prayer]) && checks.jumuah && checks.design,
      checks,
      jumuahCount,
      effectiveDate: formatDateOnly(today),
    });
  });
}

/** `if (!isGuid(id)) throw notFound()`, then the id in the spelling D1 stores. */
function organizationIdParam(value: string): string {
  if (!isGuid(value)) throw notFound();
  return normalizeId(value);
}
