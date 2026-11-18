/**
 * SQL text for the offline content sync (scripts/sync-content.mjs): the script cannot bind
 * parameters, it writes .sql files for `wrangler d1 execute --file`. Pure code, shared by
 * the script and the tests, which run the generated statements against D1.
 */
export type SqlValue = string | number | null;

/** D1 rejects statements above 100,000 bytes. */
export const MAX_STATEMENT_BYTES = 90_000;
/** 20,000 UTF-16 units are at most 60,000 bytes as a literal (3 bytes per unit, quotes doubled). */
export const TEXT_CHUNK_CHARS = 20_000;

const encoder = new TextEncoder();

export function sqlLiteral(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot write a non-finite number to SQL.');
    return String(value);
  }
  return `'${value.replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}

export function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Splits text into pieces of at most `size` UTF-16 units without cutting a surrogate pair. */
export function splitText(text: string, size: number = TEXT_CHUNK_CHARS): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

export interface RowOptions {
  /** Columns of a unique index: the ON CONFLICT target and the WHERE of continuation statements. */
  key: readonly string[];
  /** INSERT ... ON CONFLICT (key) DO UPDATE instead of a plain INSERT. */
  upsert?: boolean;
  /** Columns written on insert only (left alone when the row already exists). */
  insertOnly?: readonly string[];
}

/**
 * The statements that write one row. Normally a single INSERT; when that would exceed the
 * statement limit, long text values are inserted in pieces: the first piece with the row,
 * the rest appended by UPDATE ... SET col = col || 'piece'.
 */
export function rowStatements(table: string, row: Readonly<Record<string, SqlValue>>, options: RowOptions): string[] {
  const columns = Object.keys(row);
  const build = (values: Record<string, SqlValue>): string => {
    let sql = `INSERT INTO ${quoteName(table)} (${columns.map(quoteName).join(', ')}) VALUES (${columns.map((column) => sqlLiteral(values[column] ?? null)).join(', ')})`;
    if (options.upsert) {
      const updated = columns.filter((column) => !options.key.includes(column) && !options.insertOnly?.includes(column));
      sql += ` ON CONFLICT (${options.key.map(quoteName).join(', ')}) DO UPDATE SET ${updated.map((column) => `${quoteName(column)} = excluded.${quoteName(column)}`).join(', ')}`;
    }
    return sql + ';';
  };

  const single = build(row);
  if (encoder.encode(single).length <= MAX_STATEMENT_BYTES) return [single];

  const first: Record<string, SqlValue> = { ...row };
  const continuations: string[] = [];
  const where = options.key.map((column) => `${quoteName(column)} = ${sqlLiteral(row[column] ?? null)}`).join(' AND ');
  // Split the longest values first, and only as many as needed to bring the INSERT under the limit.
  const longTexts = columns
    .filter((column) => !options.key.includes(column) && typeof row[column] === 'string' && (row[column] as string).length > 2_000)
    .sort((left, right) => (row[right] as string).length - (row[left] as string).length);
  for (const column of longTexts) {
    const pieceSize = Math.max(1_000, Math.floor(TEXT_CHUNK_CHARS / longTexts.length));
    const pieces = splitText(row[column] as string, pieceSize);
    first[column] = pieces[0] ?? '';
    for (const piece of pieces.slice(1)) {
      continuations.push(`UPDATE ${quoteName(table)} SET ${quoteName(column)} = ${quoteName(column)} || ${sqlLiteral(piece)} WHERE ${where};`);
    }
    if (encoder.encode(build(first)).length <= MAX_STATEMENT_BYTES) break;
  }
  const insert = build(first);
  if (encoder.encode(insert).length > MAX_STATEMENT_BYTES) throw new Error(`A ${table} row is too large for one SQL statement.`);
  return [insert, ...continuations];
}
