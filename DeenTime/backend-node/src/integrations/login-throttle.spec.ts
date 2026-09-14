import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle.js';

function clock(start = '2026-09-10T12:00:00Z'): { throttle: LoginThrottle; advance(seconds: number): void } {
  let current = new Date(start).getTime();
  const throttle = new LoginThrottle({ now: () => new Date(current) });
  return {
    throttle,
    advance: (seconds) => {
      current += seconds * 1000;
    },
  };
}

function fail(throttle: LoginThrottle, email: string, times: number): void {
  for (let index = 0; index < times; index += 1) throttle.recordFailure(email);
}

describe('LoginThrottle', () => {
  it('allows unknown emails and emails with fewer than five failures', () => {
    const { throttle } = clock();
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    fail(throttle, 'imam@masjid.test', 4);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('blocks after five failures with escalating retry periods', () => {
    const { throttle, advance } = clock();
    fail(throttle, 'imam@masjid.test', 5);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 60 });

    advance(30.2);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 30 });

    throttle.recordFailure('imam@masjid.test'); // 6th → 2 minutes
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 120 });
    throttle.recordFailure('imam@masjid.test'); // 7th → 4 minutes
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 240 });
    throttle.recordFailure('imam@masjid.test'); // 8th → 8 minutes
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 480 });
    throttle.recordFailure('imam@masjid.test'); // 9th → capped at 15 minutes
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 900 });
    throttle.recordFailure('imam@masjid.test'); // 10th → still 15 minutes
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 900 });

    advance(899.5);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    advance(0.5);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('allows the attempt again once the block elapses and keeps counting failures', () => {
    const { throttle, advance } = clock();
    fail(throttle, 'imam@masjid.test', 5);
    advance(60);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    throttle.recordFailure('imam@masjid.test');
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });

  it('is per email and reset clears the entry', () => {
    const { throttle } = clock();
    fail(throttle, 'imam@masjid.test', 5);
    expect(throttle.canAttempt('other@masjid.test')).toEqual({ allowed: true });
    throttle.reset('imam@masjid.test');
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    fail(throttle, 'imam@masjid.test', 4);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
  });

  it('restarts the failure window after 15 minutes', () => {
    const { throttle, advance } = clock();
    fail(throttle, 'imam@masjid.test', 4);
    advance(15 * 60 + 1);
    fail(throttle, 'imam@masjid.test', 4);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    throttle.recordFailure('imam@masjid.test');
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it('forgets an email after an hour without activity (sliding expiration)', () => {
    const { throttle, advance } = clock();
    fail(throttle, 'imam@masjid.test', 5);
    expect(throttle.size).toBe(1);

    advance(59 * 60);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    advance(59 * 60);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    expect(throttle.size).toBe(1); // each access slid the expiration forward

    advance(60 * 60);
    expect(throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    expect(throttle.size).toBe(0);
  });

  it('sweeps expired entries periodically', () => {
    const { throttle, advance } = clock();
    for (let index = 0; index < 255; index += 1) throttle.recordFailure(`user${index}@masjid.test`);
    expect(throttle.size).toBe(255);

    advance(60 * 60);
    throttle.recordFailure('late@masjid.test'); // 256th failure triggers the sweep
    expect(throttle.size).toBe(1);
    expect(throttle.canAttempt('late@masjid.test')).toEqual({ allowed: true });
  });
});
