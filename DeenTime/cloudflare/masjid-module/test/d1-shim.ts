// A D1-compatible wrapper over node:sqlite so the API can be tested without Cloudflare.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../src/masjid-api.js';

export function createTestDb(): Db & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  // Stand-in for the shared backend's users table (its 0001_init.sql), which 0002 references.
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);');
  db.exec(readFileSync(new URL('../migrations/0002_masjids.sql', import.meta.url), 'utf8'));
  for (const [id, email, name] of [['user-amina', 'amina@example.org', 'Amina'], ['user-omar', 'omar@example.org', 'Omar']]) {
    db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, 0)').run(id, email, name, 'x');
  }
  const statement = (sql: string, values: unknown[] = []): DbStatement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => ((db.prepare(sql).get(...(values as never[])) as T) ?? null),
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => db.prepare(sql).run(...(values as never[])),
  });
  return {
    raw: db,
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
