import { z } from 'zod';
import { authorize, authorizeRoles, canAccessOrganization } from '../core/auth.js';
import { currentUser, db, type App } from '../core/context.js';
import { fromDbBool, newId, normalizeId, now } from '../core/db.js';
import { badRequestText, forbidden, notFound } from '../core/errors.js';
import { empty } from '../core/http.js';
import { EMPTY_GUID, formatDateTime, isGuid, parseDateOnly } from '../core/json.js';
import { parseBody } from '../core/validation.js';
import { generateHijriMonthMaps } from '../domain/hijri.js';

interface HijriMonthMapRow {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  hijriDayOnFirst: number;
  hijriMonthOnFirst: number;
  hijriYearOnFirst: number;
  locked: boolean;
  updatedAtUtc: Date | string;
}

/** "HijriMonthMaps" row as D1 returns it. */
interface HijriMonthMapDbRow {
  Id: string;
  OrganizationId: string;
  Year: number;
  Month: number;
  HijriDayOnFirst: number;
  HijriMonthOnFirst: number;
  HijriYearOnFirst: number;
  Locked: number;
  UpdatedAtUtc: string;
}

function fromDb(row: HijriMonthMapDbRow): HijriMonthMapRow {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    year: row.Year,
    month: row.Month,
    hijriDayOnFirst: row.HijriDayOnFirst,
    hijriMonthOnFirst: row.HijriMonthOnFirst,
    hijriYearOnFirst: row.HijriYearOnFirst,
    locked: fromDbBool(row.Locked),
    updatedAtUtc: row.UpdatedAtUtc,
  };
}

/** HijriMonthMap entity JSON. */
export function toHijriMonthMapJson(row: HijriMonthMapRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    year: row.year,
    month: row.month,
    hijriDayOnFirst: row.hijriDayOnFirst,
    hijriMonthOnFirst: row.hijriMonthOnFirst,
    hijriYearOnFirst: row.hijriYearOnFirst,
    locked: row.locked,
    updatedAtUtc: formatDateTime(row.updatedAtUtc),
  };
}

/** HijriUpsertRequest (no validator; model binding defaults). */
const hijriUpsertSchema = z.object({
  organizationId: z.string().nullish().transform((value) => (value && isGuid(value) ? value : EMPTY_GUID)),
  year: z.coerce.number().int().default(0),
  month: z.coerce.number().int().default(0),
  hijriDayOnFirst: z.coerce.number().int().default(0),
  hijriMonthOnFirst: z.coerce.number().int().nullish().transform((value) => value ?? null),
  hijriYearOnFirst: z.coerce.number().int().nullish().transform((value) => value ?? null),
  locked: z.boolean().default(false),
});

const INSERT_SQL =
  'INSERT INTO "HijriMonthMaps" ("Id", "OrganizationId", "Year", "Month", "HijriDayOnFirst", "HijriMonthOnFirst", "HijriYearOnFirst", "Locked", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

function parseMonthRange(from: string | undefined, to: string | undefined, invalidMessage: string): { fromDate: Date; toDate: Date } {
  const fromDate = parseDateOnly(`${from ?? ''}-01`);
  const toDate = parseDateOnly(`${to ?? ''}-01`);
  if (!fromDate || !toDate) throw badRequestText(invalidMessage);
  const months = (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 + toDate.getUTCMonth() - fromDate.getUTCMonth();
  if (toDate.getTime() < fromDate.getTime() || months > 24) throw badRequestText('Date range must be no more than 24 months.');
  return { fromDate, toDate };
}

/** Bounds of `"Year" * 12 + "Month"` for the months from `fromDate` to `toDate` inclusive. */
function monthKeys(fromDate: Date, toDate: Date): [number, number] {
  return [fromDate.getUTCFullYear() * 12 + fromDate.getUTCMonth() + 1, toDate.getUTCFullYear() * 12 + toDate.getUTCMonth() + 1];
}

const IN_RANGE_SQL = '"OrganizationId" = ? AND "Year" * 12 + "Month" BETWEEN ? AND ?';

/**
 * /api/v1/hijri: Hijri month maps.
 * Port of backend-node/src/modules/hijri/hijri.controller.ts.
 */
export function register(app: App): void {
  app.get('/api/v1/hijri/:orgId', authorize(), async (c) => {
    const rawOrgId = c.req.param('orgId');
    if (!isGuid(rawOrgId)) throw notFound();
    const orgId = normalizeId(rawOrgId);
    if (!canAccessOrganization(currentUser(c), orgId)) throw forbidden();
    const { fromDate, toDate } = parseMonthRange(c.req.query('from'), c.req.query('to'), 'Invalid YYYY-MM range');
    const stored = (await db(c).all<HijriMonthMapDbRow>(`SELECT * FROM "HijriMonthMaps" WHERE ${IN_RANGE_SQL} ORDER BY "Year", "Month"`, orgId, ...monthKeys(fromDate, toDate))).map(fromDb);
    const byMonth = new Map(stored.map((row) => [`${row.year}-${row.month}`, row]));
    const all = [...stored];
    // backend-node writes row by row; here the missing and repaired months go in one batch.
    const writes: D1PreparedStatement[] = [];
    for (const generated of generateHijriMonthMaps(fromDate, toDate)) {
      const existing = byMonth.get(`${generated.year}-${generated.month}`);
      if (!existing) {
        const created: HijriMonthMapRow = { id: newId(), organizationId: orgId, ...generated, updatedAtUtc: now() };
        writes.push(insertStatement(c, created));
        all.push(created);
      } else if (!existing.locked && (existing.hijriMonthOnFirst <= 0 || existing.hijriYearOnFirst <= 1)) {
        const updated: HijriMonthMapRow = {
          ...existing,
          hijriDayOnFirst: generated.hijriDayOnFirst,
          hijriMonthOnFirst: generated.hijriMonthOnFirst,
          hijriYearOnFirst: generated.hijriYearOnFirst,
          updatedAtUtc: now(),
        };
        writes.push(
          db(c).stmt(
            'UPDATE "HijriMonthMaps" SET "HijriDayOnFirst" = ?, "HijriMonthOnFirst" = ?, "HijriYearOnFirst" = ?, "UpdatedAtUtc" = ? WHERE "Id" = ?',
            updated.hijriDayOnFirst,
            updated.hijriMonthOnFirst,
            updated.hijriYearOnFirst,
            updated.updatedAtUtc as string,
            updated.id,
          ),
        );
        all[all.indexOf(existing)] = updated;
      }
    }
    await db(c).batch(writes);
    return c.json(all.sort((a, b) => a.year - b.year || a.month - b.month).map(toHijriMonthMapJson));
  });

  app.post('/api/v1/hijri', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, hijriUpsertSchema);
    if (!canAccessOrganization(currentUser(c), req.organizationId)) throw forbidden();
    const created: HijriMonthMapRow = {
      id: newId(),
      organizationId: normalizeId(req.organizationId),
      year: req.year,
      month: req.month,
      hijriDayOnFirst: req.hijriDayOnFirst,
      hijriMonthOnFirst: req.hijriMonthOnFirst ?? 1,
      hijriYearOnFirst: req.hijriYearOnFirst ?? 1,
      locked: req.locked,
      updatedAtUtc: now(),
    };
    await insertStatement(c, created).run();
    c.header('Location', `/api/v1/hijri/${created.id}`);
    return c.json(toHijriMonthMapJson(created), 201);
  });

  app.put('/api/v1/hijri/:id', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, hijriUpsertSchema);
    const id = c.req.param('id');
    const existing = isGuid(id) ? await db(c).first<HijriMonthMapDbRow>('SELECT * FROM "HijriMonthMaps" WHERE "Id" = ?', normalizeId(id)) : null;
    if (!existing) throw notFound();
    if (!canAccessOrganization(currentUser(c), existing.OrganizationId)) throw forbidden();
    if (req.organizationId.toLowerCase() !== existing.OrganizationId.toLowerCase()) throw badRequestText('A Hijri record cannot be moved to another masjid.');
    await db(c).run(
      'UPDATE "HijriMonthMaps" SET "Year" = ?, "Month" = ?, "HijriDayOnFirst" = ?, "HijriMonthOnFirst" = ?, "HijriYearOnFirst" = ?, "Locked" = ?, "UpdatedAtUtc" = ? WHERE "Id" = ?',
      req.year,
      req.month,
      req.hijriDayOnFirst,
      req.hijriMonthOnFirst ?? existing.HijriMonthOnFirst,
      req.hijriYearOnFirst ?? existing.HijriYearOnFirst,
      req.locked,
      now(),
      existing.Id,
    );
    return empty(c, 204);
  });

  app.post('/api/v1/hijri/regenerate/:orgId', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const rawOrgId = c.req.param('orgId');
    if (!isGuid(rawOrgId)) throw notFound();
    const orgId = normalizeId(rawOrgId);
    if (!canAccessOrganization(currentUser(c), orgId)) throw forbidden();
    const { fromDate, toDate } = parseMonthRange(c.req.query('from'), c.req.query('to'), 'Invalid range');
    const keys = monthKeys(fromDate, toDate);
    const lockedRows = await db(c).all<{ Year: number; Month: number }>(`SELECT "Year", "Month" FROM "HijriMonthMaps" WHERE ${IN_RANGE_SQL} AND "Locked" <> 0`, orgId, ...keys);
    const locked = new Set(lockedRows.map((row) => `${row.Year}-${row.Month}`));
    const generated = generateHijriMonthMaps(fromDate, toDate).filter((row) => !locked.has(`${row.year}-${row.month}`));
    // The array-form $transaction: unlocked months in the range are replaced atomically.
    await db(c).batch([
      db(c).stmt(`DELETE FROM "HijriMonthMaps" WHERE ${IN_RANGE_SQL} AND "Locked" = 0`, orgId, ...keys),
      ...generated.map((row) => insertStatement(c, { id: newId(), organizationId: orgId, ...row, updatedAtUtc: now() })),
    ]);
    return c.json({ regenerated: generated.length, preservedLocked: locked.size });
  });

  function insertStatement(c: Parameters<typeof db>[0], row: HijriMonthMapRow): D1PreparedStatement {
    return db(c).stmt(
      INSERT_SQL,
      row.id,
      row.organizationId,
      row.year,
      row.month,
      row.hijriDayOnFirst,
      row.hijriMonthOnFirst,
      row.hijriYearOnFirst,
      row.locked,
      row.updatedAtUtc as string,
    );
  }
}
