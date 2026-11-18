import { fromDbBool } from '../../core/db.js';
import { dateOnlyFromDb } from '../../core/json.js';
import type { CriteriaRow, OrganizationRow } from './organization.mapper.js';

/** "Organizations" row as D1 returns it. */
export interface OrganizationDbRow {
  Id: string;
  Slug: string;
  Name: string;
  NormalizedName: string;
  NormalizedWebsiteHost: string | null;
  AddressFingerprint: string | null;
  MasjidIdentityKey: string | null;
  AdminUserId: string | null;
  AddressLine: string | null;
  City: string | null;
  State: string | null;
  ZipCode: string | null;
  Phone: string | null;
  WebsiteUrl: string | null;
  Email: string | null;
  SocialUrl: string | null;
  UpdatedAtUtc: string;
}

/** "PrayerTimingCriteria" row as D1 returns it. */
export interface CriteriaDbRow {
  Id: string;
  OrganizationId: string;
  Method: string;
  JuristicMethodAsr: string;
  Latitude: number;
  Longitude: number;
  TimezoneId: string;
  DstObserved: number;
  DstBegins: string | null;
  DstEnds: string | null;
  ZipCode: string;
  MinutesAfterZawal: number;
  MinutesAfterMaghrib: number;
  KhutbahTimeMinutes: number;
  UpdatedAtUtc: string;
}

/** D1 row to the row shape Prisma returned in backend-node (what the mapper consumes). */
export function organizationFromDb(row: OrganizationDbRow): OrganizationRow {
  return {
    id: row.Id,
    slug: row.Slug,
    name: row.Name,
    normalizedName: row.NormalizedName,
    normalizedWebsiteHost: row.NormalizedWebsiteHost,
    addressFingerprint: row.AddressFingerprint,
    masjidIdentityKey: row.MasjidIdentityKey,
    adminUserId: row.AdminUserId,
    addressLine: row.AddressLine,
    city: row.City,
    state: row.State,
    zipCode: row.ZipCode,
    phone: row.Phone,
    websiteUrl: row.WebsiteUrl,
    email: row.Email,
    socialUrl: row.SocialUrl,
    updatedAtUtc: new Date(row.UpdatedAtUtc),
  };
}

export function criteriaFromDb(row: CriteriaDbRow): CriteriaRow {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    method: row.Method,
    juristicMethodAsr: row.JuristicMethodAsr,
    latitude: row.Latitude,
    longitude: row.Longitude,
    timezoneId: row.TimezoneId,
    dstObserved: fromDbBool(row.DstObserved),
    dstBegins: row.DstBegins ? dateOnlyFromDb(row.DstBegins) : null,
    dstEnds: row.DstEnds ? dateOnlyFromDb(row.DstEnds) : null,
    zipCode: row.ZipCode,
    minutesAfterZawal: row.MinutesAfterZawal,
    minutesAfterMaghrib: row.MinutesAfterMaghrib,
    khutbahTimeMinutes: row.KhutbahTimeMinutes,
    updatedAtUtc: new Date(row.UpdatedAtUtc),
  };
}
