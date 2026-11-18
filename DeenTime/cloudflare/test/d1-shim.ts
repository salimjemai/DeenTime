// A D1-compatible wrapper over node:sqlite so the API can be tested without Cloudflare.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../src/masjid-api.js';

export function createTestDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(new URL('../migrations/0001_masjids.sql', import.meta.url), 'utf8'));
  const statement = (sql: string, values: unknown[] = []): DbStatement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => ((db.prepare(sql).get(...(values as never[])) as T) ?? null),
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => db.prepare(sql).run(...(values as never[])),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        for (const s of statements) await s.run();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
