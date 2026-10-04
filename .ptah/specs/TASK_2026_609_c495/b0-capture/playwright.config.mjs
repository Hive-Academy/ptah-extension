// Standalone config: lives OUTSIDE the base checkout; drives the checkout's harness helpers.
export default {
  testDir: '.',
  testMatch: ['*.spec.ts'],
  workers: 1,
  timeout: 90000,
  reporter: [['list']],
  use: { viewport: { width: 1280, height: 800 }, actionTimeout: 10000, navigationTimeout: 15000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
