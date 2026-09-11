import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * Applies the SQL migrations under prisma/migrations at startup, the way the .NET
 * API ran `db.Database.MigrateAsync()`. It records progress in Prisma's own
 * `_prisma_migrations` table so `prisma migrate` keeps working for developers.
 *
 * Databases that were provisioned by Entity Framework already contain every table
 * of the baseline migration; for those the baseline is marked as applied without
 * executing it (the Node API never touches `__EFMigrationsHistory`).
 */
export interface LocalMigration {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationReport {
  applied: string[];
  baselined: string[];
}

const MIGRATIONS_TABLE = '_prisma_migrations';

export class MigrationRunner {
  constructor(
    private readonly pool: Pool,
    private readonly migrationsDirectory: string,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  listLocal(): LocalMigration[] {
    if (!existsSync(this.migrationsDirectory)) return [];
    return readdirSync(this.migrationsDirectory)
      .filter((entry) => statSync(join(this.migrationsDirectory, entry)).isDirectory())
      .filter((entry) => existsSync(join(this.migrationsDirectory, entry, 'migration.sql')))
      .sort()
      .map((name) => {
        const sql = readFileSync(join(this.migrationsDirectory, name, 'migration.sql'), 'utf8');
        return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
      });
  }

  async ensureTable(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
  }

  async applied(): Promise<Set<string>> {
    const exists = await this.tableExists(MIGRATIONS_TABLE);
    if (!exists) return new Set();
    const result = await this.pool.query<{ migration_name: string }>(
      `SELECT "migration_name" FROM "${MIGRATIONS_TABLE}" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
    );
    return new Set(result.rows.map((row) => row.migration_name));
  }

  /** Names of local migrations not yet recorded as applied (baseline detection included). */
  async pending(): Promise<string[]> {
    const local = this.listLocal();
    const applied = await this.applied();
    const missing = local.filter((migration) => !applied.has(migration.name));
    if (missing.length === local.length && local.length > 0 && (await this.isProvisionedByEntityFramework())) {
      return missing.slice(1).map((migration) => migration.name);
    }
    return missing.map((migration) => migration.name);
  }

  async migrate(): Promise<MigrationReport> {
    const report: MigrationReport = { applied: [], baselined: [] };
    const local = this.listLocal();
    if (local.length === 0) return report;
    await this.ensureTable();
    const applied = await this.applied();

    if (applied.size === 0 && (await this.isProvisionedByEntityFramework())) {
      const baseline = local[0];
      await this.record(baseline, 'Marked as applied: schema already provisioned by Entity Framework migrations.');
      applied.add(baseline.name);
      report.baselined.push(baseline.name);
      this.log(`Baseline ${baseline.name} marked as applied (existing Entity Framework schema).`);
    }

    for (const migration of local) {
      if (applied.has(migration.name)) continue;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO "${MIGRATIONS_TABLE}" ("id", "checksum", "finished_at", "migration_name", "logs", "started_at", "applied_steps_count")
           VALUES (gen_random_uuid()::text, $1, now(), $2, NULL, now(), 1)`,
          [migration.checksum, migration.name],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`);
      } finally {
        client.release();
      }
      report.applied.push(migration.name);
      this.log(`Applied migration ${migration.name}.`);
    }
    return report;
  }

  private async record(migration: LocalMigration, logs: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO "${MIGRATIONS_TABLE}" ("id", "checksum", "finished_at", "migration_name", "logs", "started_at", "applied_steps_count")
       VALUES (gen_random_uuid()::text, $1, now(), $2, $3, now(), 0)`,
      [migration.checksum, migration.name, logs],
    );
  }

  private async isProvisionedByEntityFramework(): Promise<boolean> {
    return (await this.tableExists('__EFMigrationsHistory')) && (await this.tableExists('AppUsers'));
  }

  private async tableExists(name: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1) AS "exists"`,
      [name],
    );
    return result.rows[0]?.exists === true;
  }
}
