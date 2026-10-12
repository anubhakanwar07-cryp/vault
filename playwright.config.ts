import { config } from 'dotenv';
import { defineConfig } from '@playwright/test';

config({ path: '.env.local', quiet: true });

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 8 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: 'chrome', // use the installed Chrome — no browser download
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm dev', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 120_000 },
});
