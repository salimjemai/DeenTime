import { formatDateOnly, formatDateTime, formatTimeOnly, salahFromDb, timeOnlyFromDb, type SalahType } from '../../common/json.js';

export interface IqamaEntryRow {
  id: string;
  organizationId: string;
  date: Date;
  salah: number;
  time: Date;
  offsetMinutes: number | null;
  note: string | null;
  updatedAtUtc: Date;
}

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
    id: row.id,
    organizationId: row.organizationId,
    date: formatDateOnly(row.date),
    salah: salahFromDb(row.salah),
    time: formatTimeOnly(timeOnlyFromDb(row.time)),
    offsetMinutes: row.offsetMinutes,
    note: row.note,
    updatedAtUtc: formatDateTime(row.updatedAtUtc),
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

/** IqamaController.Current / PublicController / readiness: latest entry per Salah with Date <= effective date. */
export function latestEntriesPerSalah<T extends { salah: number; date: Date; updatedAtUtc: Date }>(entries: T[]): T[] {
  const latest = new Map<number, T>();
  for (const entry of [...entries].sort((a, b) => a.date.getTime() - b.date.getTime() || a.updatedAtUtc.getTime() - b.updatedAtUtc.getTime())) {
    latest.set(entry.salah, entry);
  }
  return [...latest.values()];
}
