import { applyD1Migrations, env } from 'cloudflare:test';
import type { TestBindings } from './test-app.js';

// Runs before every test file: migrations/*.sql applied to the file's local D1 (idempotent).
const bindings = env as unknown as TestBindings;
await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
