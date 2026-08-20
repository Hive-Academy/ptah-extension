import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the docs screenshot capture pass.
 *
 * Deliberately separate from `playwright.config.ts`: these files WRITE into
 * `apps/ptah-docs/public/screenshots/`, so they must never run as part of the
 * ordinary `e2e` target. Run them with `nx run ptah-docs:screenshots`.
 *
 * They reuse the e2e fixtures (mocked RPC, throwaway profile) rather than the
 * showcase harness, because a docs screenshot must be reproducible on any
 * machine without a real authenticated profile or live LLM calls.
 */
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './src/docs-screenshots',
  testMatch: ['**/*.shot.ts'],
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  globalSetup: './src/support/build-precheck.ts',
  reporter: [['list']],
  outputDir: '../../dist/apps/ptah-electron-e2e/docs-screenshots-results',
  use: {
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
