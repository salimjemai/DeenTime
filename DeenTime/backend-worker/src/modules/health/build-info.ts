import type { AppConfig } from '../../core/config.js';

/** Injected by scripts/build.mjs (esbuild `define`); absent under vitest and `wrangler dev`. */
declare const __BUILD_COMMIT_SHA__: string | undefined;
declare const __BUILD_TIME_UTC__: string | undefined;

/** Latest file in migrations/; keep in sync when adding a migration. */
export const CURRENT_SCHEMA_VERSION = '0001_init';

/**
 * One table created by each migration, oldest first. /health/ready reports a migration
 * as pending while its table is missing. Add an entry with every new migration.
 */
export const MIGRATION_PROBES: ReadonlyArray<{ migration: string; table: string }> = [{ migration: '0001_init', table: 'RateLimitWindows' }];

export interface BuildInfo {
  commitSha: string;
  buildTimeUtc: string;
  schemaVersion: string;
  apiVersion: string;
}

/** Set on the first call: Workers do not expose the clock while a module is loading. */
let isolateStart: Date | null = null;

export function buildInfo(config: AppConfig): BuildInfo {
  const bakedSha = typeof __BUILD_COMMIT_SHA__ === 'string' ? __BUILD_COMMIT_SHA__ : '';
  const bakedTime = typeof __BUILD_TIME_UTC__ === 'string' ? __BUILD_TIME_UTC__ : '';
  let buildTime = new Date(config.get('Build:TimeUtc') || bakedTime || NaN);
  if (Number.isNaN(buildTime.getTime())) buildTime = isolateStart ??= new Date();
  return {
    commitSha: config.getOrDefault('Build:CommitSha', bakedSha || 'local'),
    buildTimeUtc: buildTime.toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    apiVersion: config.getOrDefault('Build:ApiVersion', '1.0.0.0'),
  };
}
