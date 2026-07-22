import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Ptah landing-page E2E harness.
 *
 * Drives the Angular marketing/portal SPA (`apps/ptah-landing-page`) in a real
 * Chromium browser against the dev server on :4200, which proxies `/api` and
 * `/webhooks` to the local license server on :3000 (`proxy.conf.json`) — so the
 * SPA and API are same-origin and cookie auth works.
 *
 * Auth is injected without the WorkOS UI (handoff §1.2): fixtures mint a
 * `ptah_auth` HS256 JWT + set the `ptah_auth_hint` localStorage flag. See
 * `src/support/fixtures.ts`.
 *
 * Preconditions (asserted by `global-setup.ts`): the license server + Postgres
 * must be up (`docker compose up -d`). The full backend smoke
 * (`node scripts/discourse-e2e.mjs` etc.) is the API-level layer beneath these
 * UI specs — run it separately before a full pass.
 */
const isCI = !!process.env['CI'];
const BASE_URL = process.env['E2E_BASE_URL'] || 'http://localhost:4200';

export default defineConfig({
  testDir: './src/specs',
  testMatch: ['**/*.spec.ts'],
  // Cap parallelism: the suite mixes stubbed-fast specs with real-backend ones
  // (auth/profile/guards/admin) against a single HMR dev server + license server,
  // so too many concurrent workers cause contention/OOM flakiness.
  workers: isCI ? 1 : 2,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  globalSetup: './src/support/global-setup.ts',
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
    // Record a webm of every run locally so the flows are watchable (and reusable
    // as raw capture for promo videos). CI keeps failures only. Set E2E_VIDEO=off
    // to disable locally. 720p @ the Desktop Chrome viewport.
    video:
      process.env['E2E_VIDEO'] === 'off'
        ? 'off'
        : isCI
          ? 'retain-on-failure'
          : { mode: 'on', size: { width: 1280, height: 720 } },
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /**
   * Auto-start the landing dev server unless one is already running (local dev).
   * The dev server alone is NOT enough — the license server + DB must be up too;
   * that is enforced by `global-setup.ts`, not here.
   */
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
