import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone Playwright config for the TASK_2026_494 (Apps page) R10 visual
 * review. Lives under the task folder (not under libs/) per the review
 * brief. Points testDir at this folder only and reuses the real webview
 * build via the harness's fixture server (imported by relative path from
 * the spec file below — no files are added under libs/).
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.e2e.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
