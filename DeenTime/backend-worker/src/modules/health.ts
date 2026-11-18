import { config, db, type App } from '../core/context.js';
import { buildInfo, CURRENT_SCHEMA_VERSION, MIGRATION_PROBES } from './health/build-info.js';

interface DatabaseReadinessResult {
  ready: boolean;
  status: 'ready' | 'migrations-pending' | 'unavailable';
  detail: string | null;
  schemaVersion: string;
  pendingMigrations: string[];
}

/** /health/live, /health/ready and /api/version. */
export function register(app: App): void {
  app.get('/health/live', (c) => c.json({ status: 'live' }));

  app.get('/health/ready', async (c) => {
    const result = await check(async () => {
      // One query proves the connection and lists the tables the migrations create.
      const tables = await db(c).all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`);
      const present = new Set(tables.map((table) => table.name));
      return MIGRATION_PROBES.filter((probe) => !present.has(probe.table)).map((probe) => probe.migration);
    });
    return c.json(result, result.ready ? 200 : 503);
  });

  app.get('/api/version', (c) => c.json(buildInfo(config(c))));
}

async function check(pendingMigrations: () => Promise<string[]>): Promise<DatabaseReadinessResult> {
  try {
    const pending = await pendingMigrations();
    return {
      ready: pending.length === 0,
      status: pending.length === 0 ? 'ready' : 'migrations-pending',
      detail: pending.length === 0 ? null : 'The database has not completed all application migrations.',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pendingMigrations: pending,
    };
  } catch {
    return {
      ready: false,
      status: 'unavailable',
      detail: 'The database readiness check failed.',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pendingMigrations: [],
    };
  }
}
