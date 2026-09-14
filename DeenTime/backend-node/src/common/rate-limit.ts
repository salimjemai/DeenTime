import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth/claims.js';
import { JsonResponseException } from './errors.js';

/**
 * Fixed-window rate limiting with the same policies as Program.cs. Windows are kept
 * in memory per process (the .NET limiter was in-process too); rejected requests get
 * 429 with an empty body.
 */
export type RateLimitPolicyName = 'public' | 'auth-login' | 'auth-register' | 'auth-verify' | 'locations' | 'expensive';

interface PolicyDefinition {
  windowMs: number;
  permitLimit: number;
  partition: 'ip' | 'user';
}

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicyName, PolicyDefinition> = {
  public: { windowMs: 5_000, permitLimit: 60, partition: 'ip' },
  'auth-login': { windowMs: 60_000, permitLimit: 10, partition: 'ip' },
  'auth-register': { windowMs: 15 * 60_000, permitLimit: 5, partition: 'ip' },
  'auth-verify': { windowMs: 5 * 60_000, permitLimit: 10, partition: 'ip' },
  locations: { windowMs: 60_000, permitLimit: 45, partition: 'ip' },
  expensive: { windowMs: 10 * 60_000, permitLimit: 5, partition: 'user' },
};

export const RATE_LIMIT_METADATA = 'iqamatime:rate-limit';

/** [EnableRateLimiting("policy")] on a controller or handler. */
export const RateLimit = (policy: RateLimitPolicyName) => SetMetadata(RATE_LIMIT_METADATA, policy);

interface WindowState {
  startedAt: number;
  count: number;
}

@Injectable()
export class RateLimitStore {
  private readonly windows = new Map<string, WindowState>();
  private sweepCounter = 0;

  /** Returns true when the request is permitted in the current fixed window. */
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

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const policy =
      this.reflector.get<RateLimitPolicyName | undefined>(RATE_LIMIT_METADATA, context.getHandler()) ??
      this.reflector.get<RateLimitPolicyName | undefined>(RATE_LIMIT_METADATA, context.getClass());
    if (!policy) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const definition = RATE_LIMIT_POLICIES[policy];
    const partition =
      definition.partition === 'user'
        ? `${request.user?.orgId ?? ''}:${request.user?.sub ?? ''}`
        : (request.socket?.remoteAddress ?? request.ip ?? 'unknown');
    if (!this.store.tryAcquire(policy, partition)) throw new JsonResponseException(429, '');
    return true;
  }
}
