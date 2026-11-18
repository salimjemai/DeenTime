import { createExecutionContext, env as testEnv, waitOnExecutionContext, type D1Migration } from 'cloudflare:test';
import { servicesFor, type Env } from '../../src/core/context.js';
import { Db, newId, now, toJsonArray } from '../../src/core/db.js';
import { hashPassword } from '../../src/core/password-hasher.js';
import { memoryRateLimitStore } from '../../src/core/rate-limit.js';
import { createApp } from '../../src/app.js';
import type { App } from '../../src/core/context.js';
import { createWorker } from '../../src/index.js';

/**
 * Integration-test harness: the real worker entry against the local D1 (already migrated
 * by apply-migrations.ts) and KV, with the settings backend-node's tests use.
 *
 *   const app = await createTestApp();
 *   const { token, organization } = await app.seed.signIn({ roles: ['Admin'] });
 *   const response = await app.request('GET', `/api/v1/orgs/${organization.id}`, { token });
 */
export const TEST_PASSWORD = 'TestOnly-Password-1234';
export const TEST_SIGNING_KEY = 'test-signing-key-that-is-long-enough-123456';
export const TEST_PUBLIC_BASE_URL = 'https://public.deentime.test';
export const TEST_CLIENT_IP = '203.0.113.10';

export interface TestBindings extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const DEFAULT_SETTINGS: Record<string, string> = {
  ASPNETCORE_ENVIRONMENT: 'Testing',
  Auth__Issuer: 'deentime-test',
  Auth__Audience: 'deentime-api-test',
  Auth__SigningKey: TEST_SIGNING_KEY,
  Frontend__PublicBaseUrl: TEST_PUBLIC_BASE_URL,
  Support__Email: 'support@deentime.test',
};

export interface RequestOptions {
  /** Sent as the JSON body with Content-Type: application/json. */
  json?: unknown;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  headers?: Record<string, string>;
  /** Raw body, for requests that are not JSON. */
  body?: BodyInit;
}

export interface SeededUser {
  id: string;
  email: string;
}

export interface SeededOrganization {
  id: string;
  slug: string;
  name: string;
}

export interface TestApp {
  /** The env the worker receives: bindings plus settings. */
  env: Env;
  db: Db;
  /** Sends a request through the worker entry (API routing and the ASSETS fall-through included). */
  request(method: string, path: string, options?: RequestOptions): Promise<Response>;
  /** A session token for the user, as POST /api/v1/auth/login issues it. */
  token(user: SeededUser, organizationId: string, roles: string[]): Promise<string>;
  seed: {
    /** An AppUsers row. The password is only hashed (100,000 PBKDF2 iterations) when given. */
    user(input?: { email?: string; displayName?: string; password?: string }): Promise<SeededUser>;
    /** An Organizations row; `columns` sets any other column by its exact name. */
    organization(input?: { name?: string; slug?: string; columns?: Record<string, string | number | null> }): Promise<SeededOrganization>;
    /** An OrgUsers row linking the user to the organization with the given roles. */
    membership(organization: SeededOrganization, user: SeededUser, roles: string[]): Promise<void>;
    /** Organization + user + membership + token in one call (roles default to ['Admin']). */
    signIn(input?: { roles?: string[]; email?: string }): Promise<{ user: SeededUser; organization: SeededOrganization; token: string }>;
  };
  /** Deletes every row from every table and clears the in-memory rate-limit windows. */
  reset(): Promise<void>;
}

/** Stand-in for the Pages ASSETS binding: answers 200 "asset:<path>". */
const fakeAssets = {
  fetch: async (input: RequestInfo | URL) => new Response(`asset:${new URL(input instanceof Request ? input.url : String(input)).pathname}`),
} as unknown as Fetcher;

let sequence = 0;

export interface TestAppOptions {
  /** Settings by their environment-variable name, e.g. { Captcha__Enabled: 'true' }. */
  settings?: Record<string, string>;
  /** Adds test-only routes to the app (used by the core tests; module tests do not need it). */
  routes?: (app: App) => void;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const bindings = testEnv as unknown as TestBindings;
  const env = { ...DEFAULT_SETTINGS, ...options.settings, DB: bindings.DB, UPLOADS: bindings.UPLOADS, ASSETS: fakeAssets } as unknown as Env;
  const db = new Db(env.DB);
  const services = servicesFor(env);
  const worker = createWorker(() => {
    const built = createApp();
    options.routes?.(built);
    return built;
  });

  const app: TestApp = {
    env,
    db,
    async request(method, path, requestOptions = {}) {
      const headers = new Headers({ 'CF-Connecting-IP': TEST_CLIENT_IP, ...requestOptions.headers });
      let body = requestOptions.body;
      if (requestOptions.json !== undefined) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(requestOptions.json);
      }
      if (requestOptions.token) headers.set('Authorization', `Bearer ${requestOptions.token}`);
      const ctx = createExecutionContext();
      const response = await worker.fetch(new Request(`https://masjidhub.test${path}`, { method, headers, body, redirect: 'manual' }), env, ctx);
      await waitOnExecutionContext(ctx);
      return response;
    },
    token: (user, organizationId, roles) => services.jwt().issue(user, organizationId, roles),
    seed: {
      async user(input = {}) {
        const id = newId();
        const email = input.email ?? `user${++sequence}@masjid.test`;
        const password = input.password ? await hashPassword(input.password) : { hash: 'not-a-usable-hash', salt: '' };
        await db.run(
          'INSERT INTO "AppUsers" ("Id", "DisplayName", "Email", "PasswordHash", "PasswordSalt") VALUES (?, ?, ?, ?, ?)',
          id,
          input.displayName ?? email,
          email,
          password.hash,
          password.salt,
        );
        return { id, email };
      },
      async organization(input = {}) {
        const id = newId();
        const n = ++sequence;
        const name = input.name ?? `Test Masjid ${n}`;
        const slug = input.slug ?? `test-masjid-${n}`;
        const columns: Record<string, string | number | null> = {
          Id: id,
          Slug: slug,
          Name: name,
          NormalizedName: name.toUpperCase(),
          UpdatedAtUtc: now(),
          ...input.columns,
        };
        const names = Object.keys(columns);
        await db.run(
          `INSERT INTO "Organizations" (${names.map((column) => `"${column}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
          ...names.map((column) => columns[column]),
        );
        return { id, slug, name };
      },
      async membership(organization, user, roles) {
        await db.run(
          'INSERT INTO "OrgUsers" ("Id", "OrganizationId", "Issuer", "Subject", "Email", "DisplayName", "Roles", "LastSeenUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          newId(),
          organization.id,
          services.config.get('Auth:Issuer') ?? 'local',
          user.id,
          user.email,
          user.email,
          toJsonArray(roles),
          now(),
        );
      },
      async signIn(input = {}) {
        const roles = input.roles ?? ['Admin'];
        const organization = await app.seed.organization();
        const user = await app.seed.user({ email: input.email });
        await app.seed.membership(organization, user, roles);
        return { user, organization, token: await app.token(user, organization.id, roles) };
      },
    },
    async reset() {
      const tables = await db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
      );
      // Children before parents is not needed: every foreign key cascades or sets NULL.
      await db.batch(tables.map((table) => db.stmt(`DELETE FROM "${table.name}"`)));
      memoryRateLimitStore.reset();
    },
  };
  return app;
}
