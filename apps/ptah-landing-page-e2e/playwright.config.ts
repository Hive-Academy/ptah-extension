import { defineConfig, devices } from '@playwright/test';

/** Playwright configuration for the static PtahCode marketing site. */
const isCI = !!process.env['CI'];
const BASE_URL = process.env['E2E_BASE_URL'] || 'http://localhost:4200';

export default defineConfig({
  testDir: './src/specs',
  testMatch: ['**/*.spec.ts'],
  workers: isCI ? 1 : 2,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: '../../dist/apps/ptah-landing-page-e2e/playwright-report',
      },
    ],
  ],
  outputDir: '../../dist/apps/ptah-landing-page-e2e/test-results',
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    trace: isCI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx nx serve ptah-landing-page --configuration=development',
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
