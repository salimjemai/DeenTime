import { authorize, authorizeRoles, canAccessOrganization } from '../core/auth.js';
import { currentUser, db, type App, type Ctx } from '../core/context.js';
import { newId, normalizeId, now } from '../core/db.js';
import { badRequestText, conflict, forbidden, notFound } from '../core/errors.js';
import { empty } from '../core/http.js';
import { dateOnlyToDb, EMPTY_GUID, isGuid, parseDateOnly, salahToDb, timeOnlyToDb, utcToday } from '../core/json.js';
import { parseBody } from '../core/validation.js';
import { IQAMA_COLUMNS, latestEntriesPerSalah, salahOrder, toIqamaEntryJson, type IqamaEntryRow } from './iqama/iqama.mapper.js';
import { iqamaScheduleSchema, iqamaUpsertSchema } from './iqama/iqama.schemas.js';

const OFFSET_RANGE_MESSAGE = 'Minutes after prayer start must be between 0 and 180.';
const INSERT_SQL = `INSERT INTO "IqamaEntries" (${IQAMA_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function requireGuid(value: string | undefined): string {
  return value && isGuid(value) ? value : EMPTY_GUID;
}

function offsetOutOfRange(offsetMinutes: number | null): boolean {
  return offsetMinutes !== null && (offsetMinutes < 0 || offsetMinutes > 180);
}

/** `new Date(Date.UTC(year, 0, 1))` as backend-node binds it (years 0-99 map to 1900-1999, as Date.UTC does). */
function yearStart(year: number): string {
  const date = new Date(Date.UTC(year, 0, 1));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid year ${year}`);
  return dateOnlyToDb(date);
}

function insertParams(row: IqamaEntryRow): [string, string, string, number, string, number | null, string | null, string] {
  return [row.Id, row.OrganizationId, row.Date, row.Salah, row.Time, row.OffsetMinutes, row.Note, row.UpdatedAtUtc];
}

async function findEntry(c: Ctx, id: string): Promise<IqamaEntryRow | null> {
  if (!isGuid(id)) return null;
  return db(c).first<IqamaEntryRow>(`SELECT ${IQAMA_COLUMNS} FROM "IqamaEntries" WHERE "Id" = ?`, normalizeId(id));
}

/**
 * /api/v1/iqama: iqama entries and schedule.
 * Port of backend-node/src/modules/iqama/iqama.controller.ts.
 */
export function register(app: App): void {
  app.get('/api/v1/iqama', authorize(), async (c) => {
    const organizationId = requireGuid(c.req.query('orgId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    const yearNumber = Number.parseInt(c.req.query('year') ?? '', 10) || 0;
    const rows = await db(c).all<IqamaEntryRow>(
      `SELECT ${IQAMA_COLUMNS} FROM "IqamaEntries" WHERE "OrganizationId" = ? AND "Date" >= ? AND "Date" < ? ORDER BY "Date" ASC, "Salah" ASC`,
      normalizeId(organizationId),
      yearStart(yearNumber),
      yearStart(yearNumber + 1),
    );
    return c.json(rows.map(toIqamaEntryJson));
  });

  app.get('/api/v1/iqama/current', authorize(), async (c) => {
    const organizationId = requireGuid(c.req.query('orgId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    const date = c.req.query('date');
    const effectiveDate = (date ? parseDateOnly(date) : null) ?? utcToday();
    const history = await db(c).all<IqamaEntryRow>(
      `SELECT ${IQAMA_COLUMNS} FROM "IqamaEntries" WHERE "OrganizationId" = ? AND "Date" <= ? ORDER BY "Date" ASC, "UpdatedAtUtc" ASC`,
      normalizeId(organizationId),
      dateOnlyToDb(effectiveDate),
    );
    return c.json(
      latestEntriesPerSalah(history)
        .map(toIqamaEntryJson)
        .sort((a, b) => salahOrder(a.salah) - salahOrder(b.salah)),
    );
  });

  app.put('/api/v1/iqama/schedule', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, iqamaScheduleSchema);
    if (!canAccessOrganization(currentUser(c), req.organizationId)) throw forbidden();
    if (req.entries.length === 0) throw badRequestText('Add at least one Iqama time.');
    if (req.entries.length > 9) throw badRequestText('A schedule can contain at most nine prayer entries.');
    if (new Set(req.entries.map((entry) => entry.salah)).size !== req.entries.length) throw badRequestText('Each prayer can appear only once for an effective date.');
    if (req.entries.some((entry) => offsetOutOfRange(entry.offsetMinutes))) throw badRequestText(OFFSET_RANGE_MESSAGE);

    const organizationId = normalizeId(req.organizationId);
    const effectiveDate = dateOnlyToDb(req.effectiveDate);
    const salahValues = req.entries.map((entry) => salahToDb(entry.salah));
    const existing = await db(c).all<IqamaEntryRow>(
      `SELECT ${IQAMA_COLUMNS} FROM "IqamaEntries" WHERE "OrganizationId" = ? AND "Date" = ? AND "Salah" IN (${salahValues.map(() => '?').join(', ')})`,
      organizationId,
      effectiveDate,
      ...salahValues,
    );
    const byValue = new Map(existing.map((row) => [row.Salah, row]));
    const saved: IqamaEntryRow[] = [];
    const statements: D1PreparedStatement[] = [];
    for (const item of req.entries) {
      const value = salahToDb(item.salah);
      const data = {
        Time: timeOnlyToDb(item.time),
        OffsetMinutes: item.offsetMinutes,
        Note: item.note?.trim() ? item.note.trim() : null,
        UpdatedAtUtc: now(),
      };
      const current = byValue.get(value);
      if (current) {
        statements.push(
          db(c).stmt('UPDATE "IqamaEntries" SET "Time" = ?, "OffsetMinutes" = ?, "Note" = ?, "UpdatedAtUtc" = ? WHERE "Id" = ?', data.Time, data.OffsetMinutes, data.Note, data.UpdatedAtUtc, current.Id),
        );
        saved.push({ ...current, ...data });
      } else {
        const row: IqamaEntryRow = { Id: newId(), OrganizationId: organizationId, Date: effectiveDate, Salah: value, ...data };
        statements.push(db(c).stmt(INSERT_SQL, ...insertParams(row)));
        saved.push(row);
      }
    }
    // backend-node writes the rows one by one; here they are one transaction (and one subrequest).
    await db(c).batch(statements);
    return c.json(saved.map(toIqamaEntryJson).sort((a, b) => salahOrder(a.salah) - salahOrder(b.salah)));
  });

  app.post('/api/v1/iqama', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, iqamaUpsertSchema);
    if (!canAccessOrganization(currentUser(c), req.organizationId)) throw forbidden();
    if (offsetOutOfRange(req.offsetMinutes)) throw badRequestText(OFFSET_RANGE_MESSAGE);
    const row: IqamaEntryRow = {
      Id: newId(),
      OrganizationId: normalizeId(req.organizationId),
      Date: dateOnlyToDb(req.date),
      Salah: salahToDb(req.salah),
      Time: timeOnlyToDb(req.time),
      OffsetMinutes: req.offsetMinutes,
      Note: req.note,
      UpdatedAtUtc: now(),
    };
    const duplicate = await db(c).first('SELECT "Id" FROM "IqamaEntries" WHERE "OrganizationId" = ? AND "Date" = ? AND "Salah" = ?', row.OrganizationId, row.Date, row.Salah);
    if (duplicate) throw conflict('An Iqama entry already exists for that prayer and effective date.');
    await db(c).run(INSERT_SQL, ...insertParams(row));
    c.header('Location', `/api/v1/iqama/${row.Id}`);
    return c.json(toIqamaEntryJson(row), 201);
  });

  app.put('/api/v1/iqama/:id', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, iqamaUpsertSchema);
    const existing = await findEntry(c, c.req.param('id'));
    if (!existing) throw notFound();
    if (!canAccessOrganization(currentUser(c), existing.OrganizationId) || req.organizationId.toLowerCase() !== existing.OrganizationId.toLowerCase()) throw forbidden();
    if (offsetOutOfRange(req.offsetMinutes)) throw badRequestText(OFFSET_RANGE_MESSAGE);
    await db(c).run(
      'UPDATE "IqamaEntries" SET "Date" = ?, "Salah" = ?, "Time" = ?, "Note" = ?, "OffsetMinutes" = ?, "UpdatedAtUtc" = ? WHERE "Id" = ?',
      dateOnlyToDb(req.date),
      salahToDb(req.salah),
      timeOnlyToDb(req.time),
      req.note,
      req.offsetMinutes,
      now(),
      existing.Id,
    );
    return empty(c, 204);
  });

  app.delete('/api/v1/iqama/:id', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const existing = await findEntry(c, c.req.param('id'));
    if (!existing) throw notFound();
    if (!canAccessOrganization(currentUser(c), existing.OrganizationId)) throw forbidden();
    await db(c).run('DELETE FROM "IqamaEntries" WHERE "Id" = ?', existing.Id);
    return empty(c, 204);
  });
}
