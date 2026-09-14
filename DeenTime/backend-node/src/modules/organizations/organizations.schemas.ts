import { IANAZone } from 'luxon';
import { z } from 'zod';
import { parseDateOnly } from '../../common/json.js';

const optionalText = z.string().nullish().transform((value) => value ?? null);

/** OrganizationUpdateRequest (Name required by model binding; the rest optional). */
export const organizationUpdateSchema = z.object({
  name: z.string({ message: "The Name field is required." }),
  addressLine: optionalText,
  city: optionalText,
  state: optionalText,
  zipCode: optionalText,
  phone: optionalText,
  websiteUrl: optionalText,
  email: optionalText,
  socialUrl: optionalText,
});
export type OrganizationUpdateRequest = z.infer<typeof organizationUpdateSchema>;

const METHODS = ['ISNA', 'MWL', 'Egyptian', 'Karachi', 'UmmAlQura', 'Gulf', 'Kuwait', 'Qatar', 'Tehran', 'Jafari'];

const optionalDate = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = parseDateOnly(value);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'The value is not a valid date.' });
      return z.NEVER;
    }
    return parsed;
  });

const number = (name: string) => z.coerce.number({ message: `The ${name} field is required.` });

/** PrayerTimingCriteria body + PrayerTimingCriteriaValidator rules and messages. */
export const criteriaSchema = z
  .object({
    method: z.string().default('ISNA').refine((value) => METHODS.some((m) => m.toLowerCase() === value.toLowerCase()), { message: 'Select a supported prayer calculation method.' }),
    juristicMethodAsr: z
      .string()
      .default('Other')
      .refine((value) => ['other', 'hanafi'].includes(value.toLowerCase()), { message: 'Asr method must be Standard or Hanafi.' }),
    latitude: number('Latitude').refine((value) => value >= -90 && value <= 90, { message: "'Latitude' must be between -90 and 90." }),
    longitude: number('Longitude').refine((value) => value >= -180 && value <= 180, { message: "'Longitude' must be between -180 and 180." }),
    timezoneId: z
      .string()
      .default('America/Chicago')
      .refine((value) => value.trim().length > 0, { message: "'Timezone Id' must not be empty." })
      .refine((value) => value.trim().length === 0 || IANAZone.isValidZone(value), { message: 'Select a valid IANA timezone.' }),
    dstObserved: z.boolean().default(true),
    dstBegins: optionalDate,
    dstEnds: optionalDate,
    zipCode: z.string().nullish().transform((value) => value ?? '').refine((value) => value.length <= 32, { message: "The length of 'Zip Code' must be 32 characters or fewer." }),
    minutesAfterZawal: z.coerce.number().int().default(5).refine((value) => value >= 0 && value <= 120, { message: "'Minutes After Zawal' must be between 0 and 120." }),
    minutesAfterMaghrib: z.coerce.number().int().default(1).refine((value) => value >= 0 && value <= 120, { message: "'Minutes After Maghrib' must be between 0 and 120." }),
    khutbahTimeMinutes: z.coerce.number().int().default(20).refine((value) => value >= 0 && value <= 180, { message: "'Khutbah Time Minutes' must be between 0 and 180." }),
  })
  .superRefine((value, ctx) => {
    if (value.dstBegins && value.dstEnds && value.dstEnds.getTime() <= value.dstBegins.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['dstEnds'], message: 'DST end must be after DST start.' });
    }
  });
export type CriteriaRequest = z.infer<typeof criteriaSchema>;
