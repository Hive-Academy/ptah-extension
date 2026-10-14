export default {
  testDir: '.',
  testMatch: ['recheck.spec.ts'],
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 45000 },
  reporter: [['list']],
  use: { actionTimeout: 15000, navigationTimeout: 30000, headless: true, browserName: 'chromium' },
};
