import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface LoginThrottleOptions {
  now?: () => Date;
}

/** Optional DI token for LoginThrottleOptions (never registered in production; tests may inject a clock). */
export const LOGIN_THROTTLE_OPTIONS = Symbol('LOGIN_THROTTLE_OPTIONS');

export type LoginAttemptDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const FAILURE_WINDOW_MS = 15 * 60_000;
const BLOCK_THRESHOLD = 5;
const MAX_BLOCK_MINUTES = 15;
const INACTIVITY_TTL_MS = 60 * 60_000;
const SWEEP_INTERVAL = 256;

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number | null;
  lastAccessAt: number;
}

/**
 * Port of LoginAttemptThrottle: per-email failure counting in memory. Failures are
 * counted in a 15-minute window; from the fifth failure on the email is blocked for
 * min(15, 2^min(failures - 5, 4)) minutes. Entries expire after an hour without access
 * (the .NET sliding expiration) and are keyed by a SHA-256 of the email.
 */
@Injectable()
export class LoginThrottle {
  private readonly entries = new Map<string, AttemptState>();
  private readonly now: () => Date;
  private operations = 0;

  constructor(@Optional() @Inject(LOGIN_THROTTLE_OPTIONS) options: LoginThrottleOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** Whether a sign-in may be attempted; when blocked, the Retry-After value (max(1, ceil(seconds))). */
  canAttempt(normalizedEmail: string): LoginAttemptDecision {
    const nowMs = this.now().getTime();
    const state = this.touch(normalizedEmail, nowMs);
    if (state === undefined || state.blockedUntil === null || state.blockedUntil <= nowMs) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - nowMs) / 1000)) };
  }

  recordFailure(normalizedEmail: string): void {
    const nowMs = this.now().getTime();
    let state = this.touch(normalizedEmail, nowMs);
    if (state === undefined) {
      state = { failures: 0, windowStartedAt: nowMs, blockedUntil: null, lastAccessAt: nowMs };
      this.entries.set(LoginThrottle.key(normalizedEmail), state);
    }
    if (nowMs - state.windowStartedAt > FAILURE_WINDOW_MS) {
      state.failures = 0;
      state.windowStartedAt = nowMs;
      state.blockedUntil = null;
    }
    state.failures += 1;
    if (state.failures >= BLOCK_THRESHOLD) {
      const minutes = Math.min(MAX_BLOCK_MINUTES, 2 ** Math.min(state.failures - BLOCK_THRESHOLD, 4));
      state.blockedUntil = nowMs + minutes * 60_000;
    }
    if (++this.operations % SWEEP_INTERVAL === 0) this.sweep(nowMs);
  }

  reset(normalizedEmail: string): void {
    this.entries.delete(LoginThrottle.key(normalizedEmail));
  }

  /** Number of emails currently tracked (expired entries are dropped lazily). */
  get size(): number {
    return this.entries.size;
  }

  /** Returns the live entry, refreshing its sliding expiration, or drops an expired one. */
  private touch(normalizedEmail: string, nowMs: number): AttemptState | undefined {
    const key = LoginThrottle.key(normalizedEmail);
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

  private static key(normalizedEmail: string): string {
    return `login-failures:${createHash('sha256').update(normalizedEmail, 'utf8').digest('hex').toUpperCase()}`;
  }
}
