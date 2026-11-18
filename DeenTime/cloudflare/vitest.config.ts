import { defineConfig } from 'vitest/config';

// masjid-module/test-shared runs inside the shared backend's Workers test pool, not here.
export default defineConfig({ test: { include: ['masjid-module/test/**/*.test.ts'] } });
