import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { Db } from '../core/db.js';
import { sweepRateLimitWindows } from '../core/rate-limit.js';
import { D1LoginThrottle, MemoryLoginThrottle, type LoginThrottle } from './login-throttle.js';

function clock(start = '2026-09-10T12:00:00Z'): { throttle: MemoryLoginThrottle; advance(seconds: number): void } {
  let current = new Date(start).getTime();
  const throttle = new MemoryLoginThrottle({ now: () => new Date(current) });
  return {
    throttle,
    advance: (seconds) => {
      current += seconds * 1000;
    },
  };
}

async function fail(throttle: LoginThrottle, email: string, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) await throttle.recordFailure(email);
}

describe('MemoryLoginThrottle', async () => {
  it('allows unknown emails and emails with fewer than five failures', async () => {
    const { throttle } = clock();
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await fail(throttle, 'imam@masjid.test', 4);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('blocks after five failures with escalating retry periods', async () => {
    const { throttle, advance } = clock();
    await fail(throttle, 'imam@masjid.test', 5);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 60 });

    advance(30.2);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 30 });

    await throttle.recordFailure('imam@masjid.test'); // 6th → 2 minutes
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 120 });
    await throttle.recordFailure('imam@masjid.test'); // 7th → 4 minutes
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 240 });
    await throttle.recordFailure('imam@masjid.test'); // 8th → 8 minutes
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 480 });
    await throttle.recordFailure('imam@masjid.test'); // 9th → capped at 15 minutes
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 900 });
    await throttle.recordFailure('imam@masjid.test'); // 10th → still 15 minutes
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 900 });

    advance(899.5);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    advance(0.5);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('allows the attempt again once the block elapses and keeps counting failures', async () => {
    const { throttle, advance } = clock();
    await fail(throttle, 'imam@masjid.test', 5);
    advance(60);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await throttle.recordFailure('imam@masjid.test');
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });

  it('is per email and reset clears the entry', async () => {
    const { throttle } = clock();
    await fail(throttle, 'imam@masjid.test', 5);
    expect(await throttle.canAttempt('other@masjid.test')).toEqual({ allowed: true });
    await throttle.reset('imam@masjid.test');
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await fail(throttle, 'imam@masjid.test', 4);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('restarts the failure window after 15 minutes', async () => {
    const { throttle, advance } = clock();
    await fail(throttle, 'imam@masjid.test', 4);
    advance(15 * 60 + 1);
    await fail(throttle, 'imam@masjid.test', 4);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await throttle.recordFailure('imam@masjid.test');
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it('forgets an email after an hour without activity (sliding expiration)', async () => {
    const { throttle, advance } = clock();
    await fail(throttle, 'imam@masjid.test', 5);
    expect(throttle.size).toBe(1);

    advance(59 * 60);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    advance(59 * 60);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    expect(throttle.size).toBe(1); // each access slid the expiration forward

    advance(60 * 60);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    expect(throttle.size).toBe(0);
  });

  it('sweeps expired entries periodically', async () => {
    const { throttle, advance } = clock();
    for (let index = 0; index < 255; index += 1) await throttle.recordFailure(`user${index}@masjid.test`);
    expect(throttle.size).toBe(255);

    advance(60 * 60);
    await throttle.recordFailure('late@masjid.test'); // 256th failure triggers the sweep
    expect(throttle.size).toBe(1);
    expect(await throttle.canAttempt('late@masjid.test')).toEqual({ allowed: true });
  });
});

describe('D1LoginThrottle', () => {
  const db = new Db((env as unknown as { DB: D1Database }).DB);

  function d1Clock(start = '2026-09-10T12:00:00Z'): { throttle: D1LoginThrottle; advance(seconds: number): void } {
    let current = new Date(start).getTime();
    return {
      throttle: new D1LoginThrottle(db, { now: () => new Date(current) }),
      advance: (seconds) => {
        current += seconds * 1000;
      },
    };
  }

  beforeEach(async () => {
    await db.run('DELETE FROM "RateLimitWindows"');
  });

  it('allows unknown emails and emails with fewer than five failures', async () => {
    const { throttle } = d1Clock();
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await fail(throttle, 'imam@masjid.test', 4);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('blocks after five failures with escalating retry periods', async () => {
    const { throttle, advance } = d1Clock();
    await fail(throttle, 'imam@masjid.test', 5);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 60 });

    advance(30.2);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 30 });

    for (const seconds of [120, 240, 480, 900, 900]) {
      await throttle.recordFailure('imam@masjid.test');
      expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: seconds });
    }

    advance(899.5);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    advance(0.5);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('allows the attempt again once the block elapses and keeps counting failures', async () => {
    const { throttle, advance } = d1Clock();
    await fail(throttle, 'imam@masjid.test', 5);
    advance(60);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await throttle.recordFailure('imam@masjid.test');
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });

  it('is per email and reset clears the entry', async () => {
    const { throttle } = d1Clock();
    await fail(throttle, 'imam@masjid.test', 5);
    expect(await throttle.canAttempt('other@masjid.test')).toEqual({ allowed: true });
    await throttle.reset('imam@masjid.test');
    expect(await db.all('SELECT "Key" FROM "RateLimitWindows"')).toHaveLength(0);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await fail(throttle, 'imam@masjid.test', 4);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('restarts the failure window after 15 minutes, clearing a leftover block', async () => {
    const { throttle, advance } = d1Clock();
    await fail(throttle, 'imam@masjid.test', 4);
    advance(15 * 60 + 1);
    await fail(throttle, 'imam@masjid.test', 4);
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    await throttle.recordFailure('imam@masjid.test');
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 60 });

    advance(10 * 60);
    await fail(throttle, 'imam@masjid.test', 4); // 9th in the window, 10 minutes into it: blocked for 15 minutes
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 900 });
    advance(5 * 60 + 1); // the window has expired while the block still has 10 minutes to run
    await throttle.recordFailure('imam@masjid.test'); // starts a new window, which drops the block
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('is shared by every instance and survives the rate limiter sweep while it matters', async () => {
    const first = d1Clock();
    await fail(first.throttle, 'imam@masjid.test', 5);
    expect(await d1Clock().throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 60 });

    await sweepRateLimitWindows(db, new Date('2026-09-10T12:00:30Z').getTime());
    expect(await d1Clock('2026-09-10T12:00:30Z').throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it('stores only a hash of the email', async () => {
    const { throttle } = d1Clock();
    await throttle.recordFailure('imam@masjid.test');
    const rows = await db.all<{ Key: string }>('SELECT "Key" FROM "RateLimitWindows"');
    expect(rows.map((row) => row.Key)).toEqual([expect.stringMatching(/^login-failures:[0-9A-F]{64}$/)]);
  });
});
