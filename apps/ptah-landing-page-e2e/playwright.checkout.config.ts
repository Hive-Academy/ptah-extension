import { defineConfig, devices } from '@playwright/test';

/**
 * Checkout-mode E2E config (handoff §3.1–3.7).
 *
 * `buildersCheckoutEnabled` is COMPILE-TIME, so checkout-mode UI can only be
 * exercised against a build with the flag flipped. This config serves the
 * landing page with the `checkout` build configuration (environment.checkout.ts,
 * flag = true) on a SEPARATE port (:4300) so it coexists with the waitlist-mode
 * dev server on :4200.
 *
 * We set E2E_BASE_URL here, before the shared fixtures module is imported, so its
 * role contexts (builder/community/admin) target :4300 too. The `ptah_auth`
 * cookie is scoped to hostname `localhost` (port-agnostic), so auth injection
 * works across both ports.
 *
 * Paddle's overlay is a cross-origin iframe — specs stub `window.Paddle` and the
 * subscription endpoints; they assert up to `Checkout.open` + the post-completed
 * state, never driving the real iframe (§8.4).
 */
const CHECKOUT_BASE_URL = 'http://localhost:4300';
process.env['E2E_BASE_URL'] = CHECKOUT_BASE_URL;

const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './src/specs-checkout',
  testMatch: ['**/*.spec.ts'],
  // Serial: these flows do real auth round-trips + Paddle-ready polling against a
  // shared dev server, so parallel workers cause contention flakiness.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './src/support/global-setup.ts',
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder:
          '../../dist/apps/ptah-landing-page-e2e/playwright-report-checkout',
      },
    ],
  ],
  outputDir: '../../dist/apps/ptah-landing-page-e2e/test-results-checkout',
  use: {
    baseURL: CHECKOUT_BASE_URL,
    actionTimeout: 10_000,
    trace: isCI ? 'retain-on-failure' : 'off',
    video:
      process.env['E2E_VIDEO'] === 'off'
        ? 'off'
        : isCI
          ? 'retain-on-failure'
          : { mode: 'on', size: { width: 1280, height: 720 } },
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'npx nx serve ptah-landing-page --configuration=checkout --port=4300',
    cwd: '../..',
    url: CHECKOUT_BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
