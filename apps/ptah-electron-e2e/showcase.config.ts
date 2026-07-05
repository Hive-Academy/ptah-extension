import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the Ptah marketing SHOWCASE harness.
 *
 * This is a separate project from `playwright.config.ts` (the deterministic
 * e2e suite). It boots the real, authenticated Electron app against the local
 * docker backend and records high-resolution video of live agent runs for
 * marketing campaigns. See `src/showcase/_harness/*` and `docs/video-content-plan.md`.
 *
 * Differences from the e2e config:
 * - `testDir: './src/showcase'`, scenes are `*.scene.ts` (not `*.spec.ts`),
 *   so the two suites never collect each other's files.
 * - Very long timeouts — real LLM inference and multi-agent runs take minutes.
 * - One worker, fully serial, no retries (a retry would re-film the scene).
 * - Recording is owned by the launcher's `recordVideo` (high-res); Playwright's
 *   own `video` is left off here to avoid a second low-res capture.
 *
 * Run with `nx run ptah-electron-e2e:showcase` (chains the dev build + native
 * rebuild, then transcodes the result to mp4).
 */
export default defineConfig({
  testDir: './src/showcase',
  testMatch: ['**/*.scene.ts'],
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  // 15 min per scene — multi-agent live runs are slow by design.
  timeout: 15 * 60_000,
  expect: {
    timeout: 60_000,
  },
  reporter: [['list']],
  outputDir: '../../dist/apps/ptah-electron-e2e/showcase-results',
  use: {
    // Generous action timeout — the app talks to real providers.
    actionTimeout: 60_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
