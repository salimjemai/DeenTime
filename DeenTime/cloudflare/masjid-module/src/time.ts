/** Date and time-of-day formats the prayer calculator returns ("2026-11-18", "13:45:00"). */
export interface TimeOnly {
  hour: number;
  minute: number;
  second: number;
}

export function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** A date held as a UTC-midnight Date, as "YYYY-MM-DD". */
export function formatDateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** "13:45:00". */
export function formatTimeOnly(value: TimeOnly): string {
  return `${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
}
