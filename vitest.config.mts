import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

const integration = process.env.VITEST_SUITE === 'integration';
// Integration tests hit the real Supabase project and providers.
if (integration) config({ path: '.env.local', quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname),
      'server-only': path.resolve(import.meta.dirname, 'tests/support/empty.ts'),
    },
  },
  test: {
    include: integration ? ['tests/integration/**/*.test.ts'] : ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: integration ? 60_000 : 5_000,
    fileParallelism: !integration,
  },
});
