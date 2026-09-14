/**
 * Serialization helpers that reproduce System.Text.Json's output for the value
 * types used by the .NET API: DateOnly ("2026-09-10"), TimeOnly ("13:45:00"),
 * DateTime (ISO-8601, UTC) and string enums.
 */
export function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** DateOnly stored as a UTC-midnight Date by Prisma ("date" columns). */
export function formatDateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function dateOnlyFromParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(dateOnly: Date, days: number): Date {
  return new Date(dateOnly.getTime() + days * 86_400_000);
}

/** DateOnly.DayNumber equivalent (days since 0001-01-01) is only compared relatively, so epoch days suffice. */
export function dayNumber(dateOnly: Date): number {
  return Math.floor(dateOnly.getTime() / 86_400_000);
}

/** Today's DateOnly in UTC, matching DateOnly.FromDateTime(DateTime.UtcNow). */
export function utcToday(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** TimeOnly stored as 1970-01-01THH:mm:ssZ by Prisma ("time" columns). */
export interface TimeOnly {
  hour: number;
  minute: number;
  second: number;
}

export function timeOnly(hour: number, minute: number, second = 0): TimeOnly {
  return { hour, minute, second };
}

export function timeOnlyFromDb(value: Date): TimeOnly {
  return { hour: value.getUTCHours(), minute: value.getUTCMinutes(), second: value.getUTCSeconds() };
}

export function timeOnlyToDb(value: TimeOnly): Date {
  return new Date(Date.UTC(1970, 0, 1, value.hour, value.minute, value.second));
}

export function parseTimeOnly(value: string): TimeOnly | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/** "13:45:00" — the default TimeOnly JSON format. */
export function formatTimeOnly(value: TimeOnly): string {
  return `${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
}

/** "13:45" — TimeOnly.ToString("HH:mm"). */
export function formatTimeShort(value: TimeOnly): string {
  return `${pad(value.hour)}:${pad(value.minute)}`;
}

/** "1:45" — TimeOnly.ToString("h:mm"). */
export function formatTimeClock(value: TimeOnly): string {
  const hour = value.hour % 12 === 0 ? 12 : value.hour % 12;
  return `${hour}:${pad(value.minute)}`;
}

export function addMinutes(value: TimeOnly, minutes: number): TimeOnly {
  const total = (((value.hour * 60 + value.minute + minutes) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60, second: value.second };
}

export function timeOnlyTotalMinutes(value: TimeOnly): number {
  return value.hour * 60 + value.minute + value.second / 60;
}

/** DateTime → ISO-8601 with 7 fractional digits like .NET? System.Text.Json emits up to 7; the frontend only parses. */
export function formatDateTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

/** SalahType is stored as an integer and serialized by name. */
export const SALAH_TYPES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Jumuah', 'Khutbah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'] as const;
export type SalahType = (typeof SALAH_TYPES)[number];
const SALAH_VALUES: Record<SalahType, number> = {
  Fajr: 1,
  Dhuhr: 2,
  Asr: 3,
  Maghrib: 4,
  Isha: 5,
  Jumuah: 6,
  Khutbah: 7,
  Jumuah2nd: 8,
  Jumuah3rd: 9,
  Jumuah4th: 10,
};

export function salahToDb(value: SalahType): number {
  return SALAH_VALUES[value];
}

export function salahFromDb(value: number): SalahType {
  const name = (Object.keys(SALAH_VALUES) as SalahType[]).find((key) => SALAH_VALUES[key] === value);
  if (!name) throw new Error(`Unknown SalahType value ${value}`);
  return name;
}

/** Accepts the enum name (case-insensitive) or its numeric value, like System.Text.Json with JsonStringEnumConverter. */
export function parseSalah(value: unknown): SalahType | null {
  if (typeof value === 'number') return Number.isInteger(value) ? salahFromDbSafe(value) : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return salahFromDbSafe(Number(trimmed));
    const match = SALAH_TYPES.find((name) => name.toLowerCase() === trimmed.toLowerCase());
    return match ?? null;
  }
  return null;
}

function salahFromDbSafe(value: number): SalahType | null {
  try {
    return salahFromDb(value);
  } catch {
    return null;
  }
}

export const PDF_SIZES = ['Letter', 'Tabloid'] as const;
export type PdfSize = (typeof PDF_SIZES)[number];
export const PDF_ORIENTATIONS = ['Portrait', 'Landscape'] as const;
export type PdfOrientation = (typeof PDF_ORIENTATIONS)[number];

export function enumToDb<T extends readonly string[]>(names: T, value: T[number]): number {
  return names.indexOf(value);
}

export function enumFromDb<T extends readonly string[]>(names: T, value: number): T[number] {
  const name = names[value];
  if (name === undefined) throw new Error(`Unknown enum value ${value}`);
  return name;
}

export function parseEnum<T extends readonly string[]>(names: T, value: unknown): T[number] | null {
  if (typeof value === 'number') return names[value] ?? null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return names[Number(trimmed)] ?? null;
    return names.find((name) => name.toLowerCase() === trimmed.toLowerCase()) ?? null;
  }
  return null;
}

/** Prisma Decimal / string / number → number (numeric columns). */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

export function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
