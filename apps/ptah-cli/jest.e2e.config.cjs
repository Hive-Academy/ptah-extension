/**
 * Separate Jest config for e2e tests so they don't co-mingle with unit
 * tests (`jest.config.cjs`). Driven by `nx e2e ptah-cli` and CI.
 *
 * Key differences from the unit config:
 *   - `testMatch` targets `tests/e2e/**\/*.e2e.spec.ts` only.
 *   - `maxWorkers: 1` — each spec spawns a real Node child process and
 *     binds stdio. Parallel runs oversubscribe Windows file-watch + DI
 *     bootstrap budgets and produce flaky failures.
 *   - `testTimeout: 60_000` — covers DI bootstrap (~10 s cold) plus a
 *     real interact handshake.
 *   - `globalSetup` aborts with a clear error if the dist bundle is
 *     missing, instead of every spec failing with an opaque ENOENT.
 *   - No `setupFilesAfterEach` — the harness owns child-process cleanup
 *     in each spec's `afterEach`.
 *   - No `moduleNameMapper` for `vscode` / `wasm-bundle-dir` — e2e tests
 *     never import production source, so transitive resolution is moot.
 */

module.exports = {
  displayName: 'ptah-cli-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/e2e/**/*.e2e.spec.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
  globalSetup: '<rootDir>/tests/e2e/_harness/global-setup.cjs',
  testTimeout: 60_000,
  maxWorkers: 1,
  // Bail on the first failure — keeps the wall-clock budget under 3
  // minutes when a regression slips in. Disable locally with --no-bail.
  bail: false,
  // Verbose so the Bug N → spec mapping surfaces in CI logs.
  verbose: true,
};
