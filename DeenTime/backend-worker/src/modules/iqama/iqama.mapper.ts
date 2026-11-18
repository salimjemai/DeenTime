import { formatDateOnly, formatDateTime, formatTimeOnly, salahFromDb, timeOnlyFromDb, type SalahType } from '../../common/json.js';

/** An "IqamaEntries" row as D1 returns it (Date "YYYY-MM-DD", Time "HH:mm:ss", UpdatedAtUtc ISO text). */
export interface IqamaEntryRow {
  Id: string;
  OrganizationId: string;
  Date: string;
  Salah: number;
  Time: string;
  OffsetMinutes: number | null;
  Note: string | null;
  UpdatedAtUtc: string;
}

export const IQAMA_COLUMNS = '"Id", "OrganizationId", "Date", "Salah", "Time", "OffsetMinutes", "Note", "UpdatedAtUtc"';

/** IqamaEntry as System.Text.Json serialized it (navigation property included as null). */
export interface IqamaEntryJson {
  id: string;
  organizationId: string;
  date: string;
  salah: SalahType;
  time: string;
  offsetMinutes: number | null;
  note: string | null;
  updatedAtUtc: string | null;
  organization: null;
}

export function toIqamaEntryJson(row: IqamaEntryRow): IqamaEntryJson {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    date: formatDateOnly(row.Date),
    salah: salahFromDb(row.Salah),
    time: formatTimeOnly(timeOnlyFromDb(row.Time)),
    offsetMinutes: row.OffsetMinutes ?? null,
    note: row.Note ?? null,
    updatedAtUtc: formatDateTime(row.UpdatedAtUtc),
    organization: null,
  };
}

const SALAH_ORDER: Record<SalahType, number> = {
  Fajr: 0,
  Dhuhr: 1,
  Asr: 2,
  Maghrib: 3,
  Isha: 4,
  Jumuah: 5,
  Jumuah2nd: 6,
  Jumuah3rd: 7,
  Jumuah4th: 8,
  Khutbah: 99,
};

export function salahOrder(salah: SalahType): number {
  return SALAH_ORDER[salah] ?? 99;
}

/**
 * IqamaController.Current / PublicController / readiness: latest entry per Salah with Date <= effective date.
 * Both columns are fixed-width text that sorts chronologically, so they are compared as text.
 */
export function latestEntriesPerSalah<T extends { Salah: number; Date: string; UpdatedAtUtc: string }>(entries: T[]): T[] {
  const latest = new Map<number, T>();
  for (const entry of [...entries].sort((a, b) => compareText(a.Date, b.Date) || compareText(a.UpdatedAtUtc, b.UpdatedAtUtc))) {
    latest.set(entry.Salah, entry);
  }
  return [...latest.values()];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
