/**
 * Thin typed helper over D1: raw SQL, prepared statements, positional `?` parameters.
 * Column formats are documented in README.md ("Column formats") and migrations/0001_init.sql.
 */
export type SqlParam = string | number | boolean | null | undefined | Date;

export interface RunResult {
  /** Rows inserted, updated or deleted by the statement. */
  changes: number;
}

function toBinding(value: SqlParam): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export class Db {
  constructor(readonly d1: D1Database) {}

  /** A bound statement, for `batch`. `undefined` binds NULL, booleans bind 0/1, Dates bind their ISO string. */
  stmt(sql: string, ...params: SqlParam[]): D1PreparedStatement {
    const statement = this.d1.prepare(sql);
    return params.length === 0 ? statement : statement.bind(...params.map(toBinding));
  }

  /** First row, or null when the query returns none. */
  async first<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Promise<T | null> {
    return (await this.stmt(sql, ...params).first<T>()) ?? null;
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Promise<T[]> {
    return (await this.stmt(sql, ...params).all<T>()).results;
  }

  /** INSERT / UPDATE / DELETE. */
  async run(sql: string, ...params: SqlParam[]): Promise<RunResult> {
    const result = await this.stmt(sql, ...params).run();
    return { changes: result.meta.changes ?? 0 };
  }

  /**
   * Runs the statements in one implicit transaction: all succeed or none are applied.
   * This is the only transaction primitive on D1 (there is no interactive BEGIN/COMMIT),
   * so read what you need first, then write everything in a single batch.
   */
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return statements.length === 0 ? [] : this.d1.batch(statements);
  }
}

/** New primary key: lowercase UUID v4, the text PostgreSQL emits for uuid columns. */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Ids are compared as text in D1 while PostgreSQL uuid comparison ignores case, so
 * lowercase every id that arrives from a request before binding it.
 */
export function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

/** Current instant in the timestamptz storage format: "2026-11-18T09:30:00.000Z". */
export function now(date: Date = new Date()): string {
  return date.toISOString();
}

/** text[] column → string[] (NULL and malformed values read as []). */
export function fromJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** string[] → text[] column (JSON array text). */
export function toJsonArray(value: readonly string[] | null | undefined): string {
  return JSON.stringify(value ?? []);
}

/** boolean column (INTEGER 0/1) → boolean. */
export function fromDbBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

/** True when a write failed on a UNIQUE index (Prisma P2002 in backend-node). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
