import 'reflect-metadata';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AppConfig } from '../../src/config/configuration.js';
import { configureHttp } from '../../src/http-setup.js';
import { StartupService } from '../../src/startup/startup.service.js';

/**
 * Integration-test harness mirroring backend/DeenTime.Api.Tests/ApiIntegrationTests.cs:
 * a throwaway PostgreSQL database per test file, migrations applied by the app's own
 * runner, the super user seeded from configuration, and the full HTTP pipeline.
 */
export const TEST_PASSWORD = 'TestOnly-Password-1234';
export const TEST_SUPER_USER_EMAIL = 'admin@deentime.test';
export const TEST_PUBLIC_BASE_URL = 'https://public.deentime.test';

export interface TestApp {
  app: NestExpressApplication;
  http: () => request.Agent;
  /** Authenticated as the seeded super user. */
  superUserToken: string;
  organizationId: string;
  organizationSlug: string;
  databaseName: string;
  close(): Promise<void>;
}

const adminConnectionString =
  process.env.DEENTIME_TEST_POSTGRES_ADMIN ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

export function testConfig(databaseName: string, overrides: Record<string, string> = {}): AppConfig {
  const admin = new URL(adminConnectionString);
  const connection = `Host=${admin.hostname};Port=${admin.port || 5432};Database=${databaseName};Username=${decodeURIComponent(admin.username)};Password=${decodeURIComponent(admin.password)}`;
  return AppConfig.load({
    contentRoot: resolve(import.meta.dirname, '..', '..'),
    environmentName: 'Testing',
    env: {},
    overrides: {
      'ConnectionStrings:Default': connection,
      'Auth:Issuer': 'deentime-test',
      'Auth:Audience': 'deentime-api-test',
      'Auth:SigningKey': 'test-signing-key-that-is-long-enough-123456',
      'Frontend:PublicBaseUrl': TEST_PUBLIC_BASE_URL,
      'SuperUser:Email': TEST_SUPER_USER_EMAIL,
      'SuperUser:Password': TEST_PASSWORD,
      'SuperUser:OrgName': 'Integration Mosque',
      'SuperUser:Latitude': '30.5119418',
      'SuperUser:Longitude': '-97.8177601',
      'SuperUser:TimezoneId': 'America/Chicago',
      'Support:Email': 'support@deentime.test',
      ...overrides,
    },
  });
}

export async function createTestDatabase(): Promise<string> {
  const name = `deentime_test_${randomUUID().replace(/-/g, '')}`;
  const client = new pg.Client({ connectionString: adminConnectionString });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  return name;
}

export async function dropTestDatabase(name: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminConnectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await client.end();
  }
}

export interface TestAppOptions {
  configOverrides?: Record<string, string>;
  /** Replace providers (external services) before compiling, like ConfigureServices in the .NET tests. */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /** Boot a second instance against an existing database ("restart" scenarios); it is not dropped on close. */
  existingDatabase?: string;
  /** Skip the super-user login (for instances whose credentials changed). */
  skipLogin?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const databaseName = options.existingDatabase ?? (await createTestDatabase());
  const config = testConfig(databaseName, options.configOverrides);
  let builder = Test.createTestingModule({ imports: [AppModule.register(config, { logging: false })] });
  if (options.customize) builder = options.customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureHttp(app, config);
  await app.init();
  await app.get(StartupService).run();

  const http = () => request(app.getHttpServer());
  let superUserToken = '';
  let organizationId = '';
  let organizationSlug = '';
  if (!options.skipLogin) {
    const login = await http().post('/api/v1/auth/login').send({ email: TEST_SUPER_USER_EMAIL, password: TEST_PASSWORD });
    if (login.status !== 200) throw new Error(`Super user login failed: ${login.status} ${login.text}`);
    superUserToken = login.body.token as string;
    const organizations = await http().get('/api/v1/orgs?search=&page=1').set('Authorization', `Bearer ${superUserToken}`);
    organizationId = organizations.body.items[0].id;
    organizationSlug = organizations.body.items[0].slug;
  }

  return {
    app,
    http,
    superUserToken,
    organizationId,
    organizationSlug,
    databaseName,
    close: async () => {
      await app.close();
      if (!options.existingDatabase) await dropTestDatabase(databaseName);
    },
  };
}
