import { clientAddress } from './client-address.js';
import { currentUser, db, type Middleware } from './context.js';
import type { Db } from './db.js';
import { JsonResponseException } from './errors.js';

/**
 * Fixed-window rate limiting with the same policies and limits as backend-node; rejected
 * requests get 429 with an empty body. A window starts at the first request of a partition.
 *
 * Storage: isolates are short-lived and many, so the policies that protect accounts and
 * paid upstreams count in D1 (table "RateLimitWindows", one atomic upsert per request).
 * `public` (60 requests / 5 s on anonymous read endpoints) counts in the isolate's memory:
 * it only has to blunt bursts, and a D1 write per public request would cost more than it saves.
 */
export type RateLimitPolicyName = 'public' | 'auth-login' | 'auth-register' | 'auth-verify' | 'locations' | 'expensive';

interface PolicyDefinition {
  windowMs: number;
  permitLimit: number;
  partition: 'ip' | 'user';
  storage: 'memory' | 'd1';
}

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicyName, PolicyDefinition> = {
  public: { windowMs: 5_000, permitLimit: 60, partition: 'ip', storage: 'memory' },
  'auth-login': { windowMs: 60_000, permitLimit: 10, partition: 'ip', storage: 'd1' },
  'auth-register': { windowMs: 15 * 60_000, permitLimit: 5, partition: 'ip', storage: 'd1' },
  'auth-verify': { windowMs: 5 * 60_000, permitLimit: 10, partition: 'ip', storage: 'd1' },
  locations: { windowMs: 60_000, permitLimit: 45, partition: 'ip', storage: 'd1' },
  expensive: { windowMs: 10 * 60_000, permitLimit: 5, partition: 'user', storage: 'd1' },
};

const LONGEST_WINDOW_MS = Math.max(...Object.values(RATE_LIMIT_POLICIES).map((policy) => policy.windowMs));

interface WindowState {
  startedAt: number;
  count: number;
}

/** In-isolate windows (the `public` policy). */
export class MemoryRateLimitStore {
  private readonly windows = new Map<string, WindowState>();
  private sweepCounter = 0;

  tryAcquire(policy: RateLimitPolicyName, partitionKey: string, now = Date.now()): boolean {
    const definition = RATE_LIMIT_POLICIES[policy];
    const key = `${policy}|${partitionKey}`;
    let state = this.windows.get(key);
    if (!state || now - state.startedAt >= definition.windowMs) {
      state = { startedAt: now, count: 0 };
      this.windows.set(key, state);
    }
    if (++this.sweepCounter % 1000 === 0) this.sweep(now);
    if (state.count >= definition.permitLimit) return false;
    state.count += 1;
    return true;
  }

  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    for (const [key, state] of this.windows) {
      const policy = key.split('|')[0] as RateLimitPolicyName;
      if (now - state.startedAt >= (RATE_LIMIT_POLICIES[policy]?.windowMs ?? 0)) this.windows.delete(key);
    }
  }
}

export const memoryRateLimitStore = new MemoryRateLimitStore();

/** One atomic statement: start a new window when the stored one has expired, else count the request. */
const ACQUIRE_SQL = `INSERT INTO "RateLimitWindows" ("Key", "StartedAtMs", "Count") VALUES (?1, ?2, 1)
ON CONFLICT("Key") DO UPDATE SET
  "Count" = CASE WHEN ?2 - "StartedAtMs" >= ?3 THEN 1 ELSE "Count" + 1 END,
  "StartedAtMs" = CASE WHEN ?2 - "StartedAtMs" >= ?3 THEN ?2 ELSE "StartedAtMs" END
RETURNING "Count"`;

/** D1-backed windows (every policy except `public`). */
export async function tryAcquireD1(database: Db, policy: RateLimitPolicyName, partitionKey: string, now = Date.now()): Promise<boolean> {
  const definition = RATE_LIMIT_POLICIES[policy];
  const row = await database.first<{ Count: number }>(ACQUIRE_SQL, `${policy}|${partitionKey}`, now, definition.windowMs);
  return (row?.Count ?? 1) <= definition.permitLimit;
}

/** Deletes windows that have expired under every policy. */
export async function sweepRateLimitWindows(database: Db, now = Date.now()): Promise<void> {
  await database.run('DELETE FROM "RateLimitWindows" WHERE "StartedAtMs" < ?', now - LONGEST_WINDOW_MS);
}

/**
 * Route middleware equivalent to backend-node's @RateLimit(policy). Put it before
 * `authorize(...)`, the order backend-node's guards run in. IP policies partition on the
 * client address ("unknown" when absent); `expensive` partitions on "<orgId>:<sub>".
 */
export function rateLimit(policy: RateLimitPolicyName): Middleware {
  const definition = RATE_LIMIT_POLICIES[policy];
  return async (c, next) => {
    let partition: string;
    if (definition.partition === 'user') {
      const user = currentUser(c);
      partition = `${user?.orgId ?? ''}:${user?.sub ?? ''}`;
    } else {
      partition = clientAddress(c) ?? 'unknown';
    }
    let permitted: boolean;
    if (definition.storage === 'memory') {
      permitted = memoryRateLimitStore.tryAcquire(policy, partition);
    } else {
      const database = db(c);
      permitted = await tryAcquireD1(database, policy, partition);
      // Occasional cleanup, off the request path.
      if (Math.random() < 0.01) c.executionCtx.waitUntil(sweepRateLimitWindows(database).catch(() => undefined));
    }
    if (!permitted) throw new JsonResponseException(429, '');
    await next();
  };
}
