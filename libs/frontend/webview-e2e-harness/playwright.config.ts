import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Ptah webview E2E harness.
 *
 * Notes:
 * - The webview normally runs inside a VS Code iframe with a strict CSP and
 *   the `acquireVsCodeApi()` bridge. In this harness we serve the build
 *   output (or a minimal fixture HTML) from a local Node http server and
 *   stub the postMessage bridge via `installPostMessageBridge` (see
 *   `src/lib/postmessage-bridge.ts`).
 * - Browser binaries are NOT installed by `npm install`. CI must run
 *   `npx playwright install --with-deps chromium` before invoking the
 *   `e2e` target.
 * - Spec authors (B2/B3) should drop their files under `src/lib/scenarios/`
 *   alongside `*.e2e.spec.ts` files referenced from `testDir` below.
 */
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './src',
  testMatch: ['**/*.e2e.spec.ts'],
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: [['list']],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: isCI ? 'retain-on-failure' : 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
