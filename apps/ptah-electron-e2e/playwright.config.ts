import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the Ptah Electron E2E harness.
 *
 * Launches the built Electron app via Playwright's `_electron.launch()`
 * API (no separate `playwright-electron` package needed -- it's part of
 * @playwright/test ^1.50). Each test gets its own ElectronApplication
 * instance via the fixtures in `src/support/fixtures.ts`.
 *
 * Pre-build chain: `nx build-dev ptah-electron` + `nx copy-renderer ptah-electron`
 * is wired through `dependsOn` in project.json, so spec authors can run
 * `nx run ptah-electron-e2e:e2e` without manual prep.
 */
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './src/specs',
  testMatch: ['**/*.spec.ts'],
  // Electron apps own global state (DI container, window manager, file handles)
  // -- a single worker keeps tests deterministic.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 30_000,
  },
  globalSetup: './src/support/build-precheck.ts',
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: '../../dist/apps/ptah-electron-e2e/playwright-report',
      },
    ],
  ],
  outputDir: '../../dist/apps/ptah-electron-e2e/test-results',
  use: {
    actionTimeout: 15_000,
    trace: isCI ? 'retain-on-failure' : 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
});
