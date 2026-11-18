import { defineConfig } from 'vitest/config';

// The shared backend runs its own end-to-end masjid test (MushafPlus backend/test/masjid.test.ts).
export default defineConfig({ test: { include: ['masjid-module/test/**/*.test.ts'] } });
