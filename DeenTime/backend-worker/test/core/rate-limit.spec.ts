import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authorize } from '../../src/core/auth.js';
import { MemoryRateLimitStore, RATE_LIMIT_POLICIES, rateLimit, sweepRateLimitWindows, tryAcquireD1 } from '../../src/core/rate-limit.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('rate limiting', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp({
      routes: (hono) => {
        hono.get('/api/test/public', rateLimit('public'), (c) => c.json({ ok: true }));
        hono.post('/api/test/login', rateLimit('auth-login'), (c) => c.json({ ok: true }));
        hono.post('/api/test/register', rateLimit('auth-register'), (c) => c.json({ ok: true }));
        hono.post('/api/test/expensive', rateLimit('expensive'), authorize(), (c) => c.json({ ok: true }));
      },
    });
  });
  beforeEach(async () => {
    await app.reset();
  });

  it('has the six backend-node policies', () => {
    expect(Object.fromEntries(Object.entries(RATE_LIMIT_POLICIES).map(([name, policy]) => [name, [policy.permitLimit, policy.windowMs, policy.partition]]))).toEqual({
      public: [60, 5_000, 'ip'],
      'auth-login': [10, 60_000, 'ip'],
      'auth-register': [5, 900_000, 'ip'],
      'auth-verify': [10, 300_000, 'ip'],
      locations: [45, 60_000, 'ip'],
      expensive: [5, 600_000, 'user'],
    });
  });

  it('auth-login: 10 per client address, then 429 with an empty body', async () => {
    for (let i = 0; i < 10; i++) expect((await app.request('POST', '/api/test/login')).status, `request ${i + 1}`).toBe(200);
    const rejected = await app.request('POST', '/api/test/login');
    expect(rejected.status).toBe(429);
    expect(await rejected.text()).toBe('');
    expect(rejected.headers.get('Content-Type')).toBeNull();
    // Another address has its own window; so does another policy for the same address.
    expect((await app.request('POST', '/api/test/login', { headers: { 'CF-Connecting-IP': '2001:db8::7' } })).status).toBe(200);
    expect((await app.request('POST', '/api/test/register')).status).toBe(200);
  });

  it('counts in D1, keyed by policy and partition', async () => {
    await app.request('POST', '/api/test/login');
    await app.request('POST', '/api/test/login');
    expect(await app.db.all('SELECT "Key", "Count" FROM "RateLimitWindows"')).toEqual([{ Key: 'auth-login|203.0.113.10', Count: 2 }]);
  });

  it('requests without a usable client address share the "unknown" partition', async () => {
    await app.request('POST', '/api/test/login', { headers: { 'CF-Connecting-IP': 'not-an-ip' } });
    await app.request('POST', '/api/test/login', { headers: { 'CF-Connecting-IP': '' } });
    expect(await app.db.all('SELECT "Key", "Count" FROM "RateLimitWindows"')).toEqual([{ Key: 'auth-login|unknown', Count: 2 }]);
  });

  it('expensive: 5 per user, counted before authorization like backend-node', async () => {
    const first = await app.seed.signIn();
    const second = await app.seed.signIn();
    for (let i = 0; i < 5; i++) expect((await app.request('POST', '/api/test/expensive', { token: first.token })).status).toBe(200);
    expect((await app.request('POST', '/api/test/expensive', { token: first.token })).status).toBe(429);
    expect((await app.request('POST', '/api/test/expensive', { token: second.token })).status).toBe(200);
    // Anonymous callers share the ":" partition: 5 × 401, then 429.
    for (let i = 0; i < 5; i++) expect((await app.request('POST', '/api/test/expensive')).status).toBe(401);
    expect((await app.request('POST', '/api/test/expensive')).status).toBe(429);
  });

  it('D1 windows are fixed: they start at the first request and reset after the window', async () => {
    const start = 1_800_000_000_000;
    for (let i = 0; i < 10; i++) expect(await tryAcquireD1(app.db, 'auth-login', 'ip', start + i)).toBe(true);
    expect(await tryAcquireD1(app.db, 'auth-login', 'ip', start + 59_999)).toBe(false);
    expect(await tryAcquireD1(app.db, 'auth-login', 'ip', start + 60_000)).toBe(true);
    expect(await app.db.first('SELECT "StartedAtMs", "Count" FROM "RateLimitWindows"')).toEqual({ StartedAtMs: start + 60_000, Count: 1 });
  });

  it('sweep removes only windows older than the longest policy window', async () => {
    const current = 1_800_000_000_000;
    await tryAcquireD1(app.db, 'auth-login', 'old', current - 15 * 60_000 - 1);
    await tryAcquireD1(app.db, 'auth-register', 'recent', current - 14 * 60_000);
    await sweepRateLimitWindows(app.db, current);
    expect(await app.db.all('SELECT "Key" FROM "RateLimitWindows"')).toEqual([{ Key: 'auth-register|recent' }]);
  });

  it('public: 60 per 5 seconds, in memory (no D1 rows)', async () => {
    for (let i = 0; i < 60; i++) expect((await app.request('GET', '/api/test/public')).status).toBe(200);
    expect((await app.request('GET', '/api/test/public')).status).toBe(429);
    expect(await app.db.all('SELECT "Key" FROM "RateLimitWindows"')).toEqual([]);
  });

  it('memory store: fixed windows per policy and partition', () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 60; i++) expect(store.tryAcquire('public', 'a', 1_000 + i)).toBe(true);
    expect(store.tryAcquire('public', 'a', 5_999)).toBe(false);
    expect(store.tryAcquire('public', 'b', 5_999)).toBe(true);
    expect(store.tryAcquire('public', 'a', 6_000)).toBe(true);
  });
});
