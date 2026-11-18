import { db, type App, type Ctx } from '../core/context.js';
import { normalizeId } from '../core/db.js';
import { badRequestText, notFound, validationProblem } from '../core/errors.js';
import { addDays, dayNumber, isGuid, parseDateOnly } from '../core/json.js';
import { rateLimit } from '../core/rate-limit.js';
import { computePrayerTimes, toPrayerTimesDto, type PrayerCriteriaInput, type PrayerTimesDto } from '../domain/prayer-times.js';
import { todayInZone } from '../domain/timezone.js';
import { criteriaToCalculatorInput } from './organizations/organization.mapper.js';
import { criteriaFromDb, type CriteriaDbRow } from './organizations/organization.rows.js';

/**
 * /api/v1/timings: computed prayer times.
 * Port of backend-node/src/modules/timings/timings.controller.ts (anonymous, "public" rate-limit policy).
 */
export function register(app: App): void {
  app.get('/api/v1/timings', rateLimit('public'), async (c) => {
    const parsed = requireDate(c.req.query('date'), 'date');
    const criteria = await findCriteria(c, c.req.query('orgId'));
    return c.json(toPrayerTimesDto(computePrayerTimes(criteria, parsed)));
  });

  app.get('/api/v1/timings/range', rateLimit('public'), async (c) => {
    const start = requireDate(c.req.query('from'), 'from');
    const end = requireDate(c.req.query('to'), 'to');
    if (end.getTime() < start.getTime()) throw badRequestText('Invalid range');
    const span = dayNumber(end) - dayNumber(start);
    if (span > 366) throw badRequestText('Date range must be no more than 367 days.');
    const criteria = await findCriteria(c, c.req.query('orgId'));
    const results: PrayerTimesDto[] = [];
    for (let offset = 0; offset <= span; offset += 1) {
      results.push(toPrayerTimesDto(computePrayerTimes(criteria, addDays(start, offset))));
    }
    return c.json(results);
  });

  app.get('/api/v1/timings/today', rateLimit('public'), async (c) => {
    const criteria = await findCriteria(c, c.req.query('orgId'));
    return c.json(toPrayerTimesDto(computePrayerTimes(criteria, todayInZone(criteria.timezoneId))));
  });
}

/** The criteria of the organization named by id or slug; 404 when either is missing. */
async function findCriteria(c: Ctx, orgId: string | undefined): Promise<PrayerCriteriaInput> {
  if (!orgId) throw validationProblem({ orgId: ['The orgId field is required.'] });
  const byId = isGuid(orgId);
  const criteria = await db(c).first<CriteriaDbRow>(
    `SELECT p.* FROM "PrayerTimingCriteria" p JOIN "Organizations" o ON o."Id" = p."OrganizationId" WHERE ${byId ? 'o."Id"' : 'o."Slug"'} = ?`,
    byId ? normalizeId(orgId) : orgId,
  );
  if (!criteria) throw notFound();
  return criteriaToCalculatorInput(criteriaFromDb(criteria));
}

function requireDate(value: string | undefined, name: string): Date {
  const parsed = value ? parseDateOnly(value) : null;
  if (!parsed) throw validationProblem({ [name]: [`The value '${value ?? ''}' is not valid.`] });
  return parsed;
}
