import { defineConfig } from '@playwright/test';

/** Smoke harness for TASK_2026_580 T1. Serial; one Electron app at a time. */
export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.smoke.ts'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 2_700_000,
  reporter: [['list']],
  outputDir: './results',
});
