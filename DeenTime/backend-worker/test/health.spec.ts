import { createExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/core/context.js';
import { createWorker } from '../src/index.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('health', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });

  it('GET /health/live', async () => {
    const response = await app.request('GET', '/health/live');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ status: 'live' });
  });

  it('GET /health/ready reports the migrated database as ready', async () => {
    const response = await app.request('GET', '/health/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ready: true,
      status: 'ready',
      detail: null,
      schemaVersion: '0001_init',
      pendingMigrations: [],
    });
  });

  it('GET /health/ready is 503 while a migration is missing', async () => {
    await app.db.run('ALTER TABLE "RateLimitWindows" RENAME TO "RateLimitWindows_hidden"');
    try {
      const response = await app.request('GET', '/health/ready');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ready: false,
        status: 'migrations-pending',
        detail: 'The database has not completed all application migrations.',
        schemaVersion: '0001_init',
        pendingMigrations: ['0001_init'],
      });
    } finally {
      await app.db.run('ALTER TABLE "RateLimitWindows_hidden" RENAME TO "RateLimitWindows"');
    }
  });

  it('GET /health/ready is 503 "unavailable" when the database cannot be queried', async () => {
    const failing = {
      prepare: () => {
        throw new Error('D1 is down');
      },
    };
    const env = { ...app.env, DB: failing } as unknown as Env;
    const response = await createWorker().fetch(new Request('https://masjidhub.test/health/ready'), env, createExecutionContext());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ready: false,
      status: 'unavailable',
      detail: 'The database readiness check failed.',
      schemaVersion: '0001_init',
      pendingMigrations: [],
    });
  });

  it('GET /api/version', async () => {
    const response = await app.request('GET', '/api/version');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, string>;
    expect(Object.keys(body)).toEqual(['commitSha', 'buildTimeUtc', 'schemaVersion', 'apiVersion']);
    expect(body.commitSha).toBe('local');
    expect(body.schemaVersion).toBe('0001_init');
    expect(body.apiVersion).toBe('1.0.0.0');
    expect(new Date(body.buildTimeUtc).toISOString()).toBe(body.buildTimeUtc);
  });

  it('GET /api/version prefers Build settings', async () => {
    const configured = await createTestApp({
      settings: { Build__CommitSha: 'abc123', Build__TimeUtc: '2026-01-02T03:04:05Z', Build__ApiVersion: '2.0.0.0' },
    });
    const response = await configured.request('GET', '/api/version');
    expect(await response.json()).toEqual({
      commitSha: 'abc123',
      buildTimeUtc: '2026-01-02T03:04:05.000Z',
      schemaVersion: '0001_init',
      apiVersion: '2.0.0.0',
    });
  });
});
