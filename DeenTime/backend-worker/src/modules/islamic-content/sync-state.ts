import type { Db } from '../../core/db.js';

export const QURAN_SYNC_SCOPES: readonly string[] = ['catalog', 'text', 'all'];

/** The IslamicContentSyncState entity as System.Text.Json serialized it. */
export interface SyncStateJson {
  key: string;
  provider: string;
  scope: string;
  status: string;
  processedItems: number;
  totalItems: number;
  message: string | null;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  updatedAtUtc: string;
}

export interface SyncStateRow {
  Key: string;
  Provider: string;
  Scope: string;
  Status: string;
  ProcessedItems: number;
  TotalItems: number;
  Message: string | null;
  StartedAtUtc: string | null;
  CompletedAtUtc: string | null;
  UpdatedAtUtc: string;
}

export const SYNC_STATES_SQL = 'SELECT * FROM "IslamicContentSyncStates" ORDER BY "Provider"';

export function toSyncStateJson(state: SyncStateRow): SyncStateJson {
  return {
    key: state.Key,
    provider: state.Provider,
    scope: state.Scope,
    status: state.Status,
    processedItems: state.ProcessedItems,
    totalItems: state.TotalItems,
    message: state.Message,
    startedAtUtc: state.StartedAtUtc,
    completedAtUtc: state.CompletedAtUtc,
    updatedAtUtc: state.UpdatedAtUtc,
  };
}

export async function readSyncStates(db: Db): Promise<SyncStateJson[]> {
  return (await db.all<SyncStateRow>(SYNC_STATES_SQL)).map(toSyncStateJson);
}

/**
 * The command that runs a synchronization. The Worker cannot run one (see
 * offline-sync.ts), so the sync endpoints answer with it instead of queueing.
 */
export function offlineSyncCommand(provider: 'quran' | 'hadith', scope: string): string {
  return provider === 'quran' ? `node scripts/sync-content.mjs --provider quran --scope ${scope}` : 'node scripts/sync-content.mjs --provider hadith';
}
