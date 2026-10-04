import { defineConfig } from '@playwright/test';

/** TASK_2026_612 evidence capture config. Run: see evidence README. */
export default defineConfig({
  testDir: './src/evidence-612',
  testMatch: ['**/*.evidence.ts'],
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: '../../dist/apps/ptah-electron-e2e/evidence-612-results',
});
