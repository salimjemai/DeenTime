import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd (the Workers runtime) against a local D1 and KV, so platform
// limits such as the PBKDF2 iteration cap are the real ones.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-11-01',
          d1Databases: ['DB'],
          kvNamespaces: ['UPLOADS'],
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
      setupFiles: ['./test/support/apply-migrations.ts'],
    },
  };
});
