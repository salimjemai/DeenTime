import { z } from 'zod';
import { isGuid, parseDateOnly, parseSalah, parseTimeOnly, EMPTY_GUID, type SalahType, type TimeOnly } from '../../common/json.js';

const guid = z.string().refine((value) => isGuid(value), { message: "'Organization Id' must not be empty." });
const dateOnly = z.string().transform((value, ctx) => {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    ctx.addIssue({ code: 'custom', message: 'The value is not a valid date.' });
    return z.NEVER;
  }
  return parsed;
});
const timeOnly = z.string().transform((value, ctx) => {
  const parsed = parseTimeOnly(value);
  if (!parsed) {
    ctx.addIssue({ code: 'custom', message: 'The value is not a valid time.' });
    return z.NEVER;
  }
  return parsed;
});
const salah = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const parsed = parseSalah(value);
  if (!parsed) {
    ctx.addIssue({ code: 'custom', message: 'The value is not a valid prayer.' });
    return z.NEVER;
  }
  return parsed;
});

/** IqamaUpsertRequest + IqamaUpsertRequestValidator (OrganizationId, Date, Time NotEmpty). */
export const iqamaUpsertSchema = z.object({
  organizationId: guid.refine((value) => value !== EMPTY_GUID, { message: "'Organization Id' must not be empty." }),
  date: dateOnly,
  salah,
  time: timeOnly.refine((value: TimeOnly) => value.hour !== 0 || value.minute !== 0 || value.second !== 0, { message: "'Time' must not be empty." }),
  note: z.string().nullish().transform((value) => value ?? null),
  offsetMinutes: z.number().int().nullish().transform((value) => value ?? null),
});
export type IqamaUpsertRequest = z.infer<typeof iqamaUpsertSchema>;

const scheduleItemSchema = z.object({
  salah,
  time: timeOnly,
  note: z.string().nullish().transform((value) => value ?? null),
  offsetMinutes: z.number().int().nullish().transform((value) => value ?? null),
});

/** IqamaScheduleUpsertRequest (no FluentValidation validator; checks are inline in the controller). */
export const iqamaScheduleSchema = z.object({
  organizationId: guid,
  effectiveDate: dateOnly,
  entries: z.array(scheduleItemSchema).nullish().transform((value) => value ?? []),
});
export type IqamaScheduleRequest = z.infer<typeof iqamaScheduleSchema>;
export type IqamaScheduleItem = { salah: SalahType; time: TimeOnly; note: string | null; offsetMinutes: number | null };
