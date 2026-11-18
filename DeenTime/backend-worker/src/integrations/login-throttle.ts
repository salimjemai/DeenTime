import type { Db } from '../core/db.js';
import { sha256HexLower } from '../core/sha256.js';

/**
 * Port of backend-node's LoginThrottle (LoginAttemptThrottle): per-email failure counting.
 * Failures are counted in a 15-minute window; from the fifth failure on the email is
 * blocked for min(15, 2^min(failures - 5, 4)) minutes. Entries are keyed by a SHA-256 of
 * the email.
 *
 * backend-node keeps the state in process memory. Isolates are short-lived and many, so
 * the worker uses D1LoginThrottle; MemoryLoginThrottle is the original algorithm behind the
 * same interface (unit tests, or a fallback store).
 */
export type LoginAttemptDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface LoginThrottle {
  /** Whether a sign-in may be attempted; when blocked, the Retry-After value (max(1, ceil(seconds))). */
  canAttempt(normalizedEmail: string): Promise<LoginAttemptDecision>;
  recordFailure(normalizedEmail: string): Promise<void>;
  reset(normalizedEmail: string): Promise<void>;
}

export interface LoginThrottleOptions {
  now?: () => Date;
}

const FAILURE_WINDOW_MS = 15 * 60_000;
const BLOCK_THRESHOLD = 5;
const MAX_BLOCK_MINUTES = 15;
const INACTIVITY_TTL_MS = 60 * 60_000;
const SWEEP_INTERVAL = 256;

function emailHash(normalizedEmail: string): string {
  return sha256HexLower(normalizedEmail).toUpperCase();
}

/** Block length after the given number of failures in the window, or null below the threshold. */
export function blockMinutes(failures: number): number | null {
  if (failures < BLOCK_THRESHOLD) return null;
  return Math.min(MAX_BLOCK_MINUTES, 2 ** Math.min(failures - BLOCK_THRESHOLD, 4));
}

function decision(blockedUntil: number | null | undefined, nowMs: number): LoginAttemptDecision {
  if (blockedUntil === null || blockedUntil === undefined || blockedUntil <= nowMs) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - nowMs) / 1000)) };
}

/**
 * D1 store in the existing "RateLimitWindows" table (Key, StartedAtMs, Count), two rows per email:
 *   login-failures:<HASH>  StartedAtMs = start of the failure window, Count = failures in it
 *   login-blocked:<HASH>   StartedAtMs = the instant the block ends,   Count = failures when it was set
 * core/rate-limit's sweep deletes rows whose StartedAtMs is more than 15 minutes old, which
 * is exactly when a failure window has expired and long after a block has ended, so it
 * never changes a decision. backend-node's one-hour inactivity expiry has no observable
 * effect either: an entry idle for an hour has an expired window and an expired block.
 */
export class D1LoginThrottle implements LoginThrottle {
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    options: LoginThrottleOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async canAttempt(normalizedEmail: string): Promise<LoginAttemptDecision> {
    const row = await this.db.first<{ StartedAtMs: number }>('SELECT "StartedAtMs" FROM "RateLimitWindows" WHERE "Key" = ?', blockedKey(normalizedEmail));
    return decision(row?.StartedAtMs, this.now().getTime());
  }

  async recordFailure(normalizedEmail: string): Promise<void> {
    const nowMs = this.now().getTime();
    // One atomic statement: start a new window when the stored one has expired, else count the failure.
    const row = await this.db.first<{ Count: number }>(
      `INSERT INTO "RateLimitWindows" ("Key", "StartedAtMs", "Count") VALUES (?1, ?2, 1)
ON CONFLICT("Key") DO UPDATE SET
  "Count" = CASE WHEN ?2 - "StartedAtMs" > ?3 THEN 1 ELSE "Count" + 1 END,
  "StartedAtMs" = CASE WHEN ?2 - "StartedAtMs" > ?3 THEN ?2 ELSE "StartedAtMs" END
RETURNING "Count"`,
      failuresKey(normalizedEmail),
      nowMs,
      FAILURE_WINDOW_MS,
    );
    const failures = row?.Count ?? 1;
    const minutes = blockMinutes(failures);
    if (minutes === null) {
      // A new window clears a block left over from the previous one (backend-node sets blockedUntil = null).
      if (failures === 1) await this.db.run('DELETE FROM "RateLimitWindows" WHERE "Key" = ?', blockedKey(normalizedEmail));
      return;
    }
    await this.db.run(
      `INSERT INTO "RateLimitWindows" ("Key", "StartedAtMs", "Count") VALUES (?1, ?2, ?3)
ON CONFLICT("Key") DO UPDATE SET "StartedAtMs" = excluded."StartedAtMs", "Count" = excluded."Count"`,
      blockedKey(normalizedEmail),
      nowMs + minutes * 60_000,
      failures,
    );
  }

  async reset(normalizedEmail: string): Promise<void> {
    await this.db.run('DELETE FROM "RateLimitWindows" WHERE "Key" IN (?, ?)', failuresKey(normalizedEmail), blockedKey(normalizedEmail));
  }
}

function failuresKey(normalizedEmail: string): string {
  return `login-failures:${emailHash(normalizedEmail)}`;
}

function blockedKey(normalizedEmail: string): string {
  return `login-blocked:${emailHash(normalizedEmail)}`;
}

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number | null;
  lastAccessAt: number;
}

/** backend-node's in-memory implementation, unchanged apart from the async interface. */
export class MemoryLoginThrottle implements LoginThrottle {
  private readonly entries = new Map<string, AttemptState>();
  private readonly now: () => Date;
  private operations = 0;

  constructor(options: LoginThrottleOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async canAttempt(normalizedEmail: string): Promise<LoginAttemptDecision> {
    const nowMs = this.now().getTime();
    return decision(this.touch(normalizedEmail, nowMs)?.blockedUntil, nowMs);
  }

  async recordFailure(normalizedEmail: string): Promise<void> {
    const nowMs = this.now().getTime();
    let state = this.touch(normalizedEmail, nowMs);
    if (state === undefined) {
      state = { failures: 0, windowStartedAt: nowMs, blockedUntil: null, lastAccessAt: nowMs };
      this.entries.set(failuresKey(normalizedEmail), state);
    }
    if (nowMs - state.windowStartedAt > FAILURE_WINDOW_MS) {
      state.failures = 0;
      state.windowStartedAt = nowMs;
      state.blockedUntil = null;
    }
    state.failures += 1;
    const minutes = blockMinutes(state.failures);
    if (minutes !== null) state.blockedUntil = nowMs + minutes * 60_000;
    if (++this.operations % SWEEP_INTERVAL === 0) this.sweep(nowMs);
  }

  async reset(normalizedEmail: string): Promise<void> {
    this.entries.delete(failuresKey(normalizedEmail));
  }

  /** Number of emails currently tracked (expired entries are dropped lazily). */
  get size(): number {
    return this.entries.size;
  }

  /** Returns the live entry, refreshing its sliding expiration, or drops an expired one. */
  private touch(normalizedEmail: string, nowMs: number): AttemptState | undefined {
    const key = failuresKey(normalizedEmail);
    const state = this.entries.get(key);
    if (state === undefined) return undefined;
    if (nowMs - state.lastAccessAt >= INACTIVITY_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    state.lastAccessAt = nowMs;
    return state;
  }

  private sweep(nowMs: number): void {
    for (const [key, state] of this.entries) {
      if (nowMs - state.lastAccessAt >= INACTIVITY_TTL_MS) this.entries.delete(key);
    }
  }
}

/** The throttle the auth module uses: `loginThrottle(db(c))`. Swap the store here. */
export function loginThrottle(db: Db): LoginThrottle {
  return new D1LoginThrottle(db);
}
