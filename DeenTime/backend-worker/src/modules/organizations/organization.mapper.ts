import { formatDateOnly, formatDateTime, toNumber } from '../../common/json.js';

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  normalizedName: string;
  normalizedWebsiteHost: string | null;
  addressFingerprint: string | null;
  masjidIdentityKey: string | null;
  adminUserId: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  websiteUrl: string | null;
  email: string | null;
  socialUrl: string | null;
  updatedAtUtc: Date;
}

export interface CriteriaRow {
  id: string;
  organizationId: string;
  method: string;
  juristicMethodAsr: string;
  latitude: unknown;
  longitude: unknown;
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

export interface DesignRow {
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

/** PrayerTimingCriteria entity JSON (navigation property serialized as null). */
export function toCriteriaJson(row: CriteriaRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    method: row.method,
    juristicMethodAsr: row.juristicMethodAsr,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    timezoneId: row.timezoneId,
    dstObserved: row.dstObserved,
    dstBegins: row.dstBegins ? formatDateOnly(row.dstBegins) : null,
    dstEnds: row.dstEnds ? formatDateOnly(row.dstEnds) : null,
    zipCode: row.zipCode,
    minutesAfterZawal: row.minutesAfterZawal,
    minutesAfterMaghrib: row.minutesAfterMaghrib,
    khutbahTimeMinutes: row.khutbahTimeMinutes,
    updatedAtUtc: formatDateTime(row.updatedAtUtc),
    organization: null,
  };
}

/** DesignSettings entity JSON. */
export function toDesignJson(row: DesignRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    headerImageUrl: row.headerImageUrl,
    iqamaHeadings: row.iqamaHeadings,
    footerHtml: row.footerHtml,
    theme: row.theme,
    tvFontScale: row.tvFontScale,
    widgetFontScale: row.widgetFontScale,
    compactFontScale: row.compactFontScale,
    tvFontFamily: row.tvFontFamily,
    widgetFontFamily: row.widgetFontFamily,
    compactFontFamily: row.compactFontFamily,
    updatedAtUtc: formatDateTime(row.updatedAtUtc),
    organization: null,
  };
}

/** Organization entity JSON; `criteria`/`design` are included only when loaded (Include). */
export function toOrganizationJson(row: OrganizationRow, related: { criteria?: CriteriaRow | null; design?: DesignRow | null } = {}): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    normalizedName: row.normalizedName,
    normalizedWebsiteHost: row.normalizedWebsiteHost,
    addressFingerprint: row.addressFingerprint,
    masjidIdentityKey: row.masjidIdentityKey,
    adminUserId: row.adminUserId,
    addressLine: row.addressLine,
    city: row.city,
    state: row.state,
    zipCode: row.zipCode,
    phone: row.phone,
    websiteUrl: row.websiteUrl,
    email: row.email,
    socialUrl: row.socialUrl,
    criteria: related.criteria ? toCriteriaJson(related.criteria) : null,
    design: related.design ? toDesignJson(related.design) : null,
    updatedAtUtc: formatDateTime(row.updatedAtUtc),
  };
}

/** Criteria row → calculator input (numbers instead of Decimal). */
export function criteriaToCalculatorInput(row: CriteriaRow): {
  method: string;
  juristicMethodAsr: string;
  latitude: number;
  longitude: number;
  timezoneId: string;
  dstObserved: boolean;
  dstBegins: Date | null;
  dstEnds: Date | null;
  minutesAfterZawal: number;
  minutesAfterMaghrib: number;
} {
  return {
    method: row.method,
    juristicMethodAsr: row.juristicMethodAsr,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    timezoneId: row.timezoneId,
    dstObserved: row.dstObserved,
    dstBegins: row.dstBegins,
    dstEnds: row.dstEnds,
    minutesAfterZawal: row.minutesAfterZawal,
    minutesAfterMaghrib: row.minutesAfterMaghrib,
  };
}
