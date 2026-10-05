import { defineConfig } from '@playwright/test';

/** MONITOR_BG_ONLY evidence capture config (not part of the normal e2e suite). */
export default defineConfig({
  testDir: './src/evidence-monitor-bg',
  testMatch: ['**/*.evidence.ts'],
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: '../../dist/apps/ptah-electron-e2e/evidence-monitor-bg-results',
});
