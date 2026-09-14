import type { IslamicContentSyncState } from '../../generated/prisma/client.js';

/** The IslamicContentSyncState entity as System.Text.Json serialized it. */
export interface SyncStateJson {
  key: string;
  provider: string;
  scope: string;
  status: string;
  processedItems: number;
  totalItems: number;
  message: string | null;
  startedAtUtc: Date | null;
  completedAtUtc: Date | null;
  updatedAtUtc: Date;
}

export function toSyncStateJson(state: IslamicContentSyncState): SyncStateJson {
  return {
    key: state.key,
    provider: state.provider,
    scope: state.scope,
    status: state.status,
    processedItems: state.processedItems,
    totalItems: state.totalItems,
    message: state.message,
    startedAtUtc: state.startedAtUtc,
    completedAtUtc: state.completedAtUtc,
    updatedAtUtc: state.updatedAtUtc,
  };
}
