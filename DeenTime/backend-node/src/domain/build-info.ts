import { statSync } from 'node:fs';
import type { AppConfig } from '../config/configuration.js';

/** Latest migration in prisma/migrations; keep in sync when adding a migration. */
export const CURRENT_SCHEMA_VERSION = '0_baseline';

export interface BuildInfo {
  commitSha: string;
  buildTimeUtc: string;
  schemaVersion: string;
  apiVersion: string;
}

const processStart = new Date();

export function buildInfo(config: AppConfig, entryFile?: string): BuildInfo {
  const configured = config.get('Build:TimeUtc');
  let buildTime = configured ? new Date(configured) : new Date(NaN);
  if (Number.isNaN(buildTime.getTime()) && entryFile) {
    try {
      buildTime = statSync(entryFile).mtime;
    } catch {
      buildTime = new Date(NaN);
    }
  }
  if (Number.isNaN(buildTime.getTime())) buildTime = processStart;
  return {
    commitSha: config.getOrDefault('Build:CommitSha', 'local'),
    buildTimeUtc: buildTime.toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    apiVersion: config.getOrDefault('Build:ApiVersion', '1.0.0.0'),
  };
}
