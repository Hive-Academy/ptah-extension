/**
 * E2E jest config for ptah-license-server-e2e.
 *
 * Layering (as of TASK_2025_294 W1.B6):
 *   - The legacy live-server smoke spec lives in `src/ptah-license-server/`
 *     and requires an external dev server on port 3000. It is only
 *     activated when `RUN_LIVE_E2E=1` (see `testPathIgnorePatterns` below).
 *   - New in-process NestJS-harness specs live in `src/*.e2e-spec.ts` and
 *     use `createTestingNestModule` + `createMockPrisma` from
 *     `apps/ptah-license-server/src/testing` for deterministic, CI-green
 *     runs on Windows with zero Docker or network dependencies.
 *
 * When `RUN_LIVE_E2E=1`, the live-server spec is re-enabled and the
 * global-setup/teardown (which wait on port 3000 and kill it) fire. All
 * other environments skip them for speed and Windows-CI friendliness.
 */
const runLive = process.env['RUN_LIVE_E2E'] === '1';

const base = {
  displayName: 'ptah-license-server-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // In-process e2e specs use the `.e2e-spec.ts` suffix; the Nx preset's
  // default `testMatch` only catches `*.spec.ts` / `*.test.ts`, so we
  // extend it here to cover the e2e variant. The legacy live-server smoke
  // spec uses plain `.spec.ts` and is gated by `testPathIgnorePatterns`.
  testMatch: ['**/?(*.)+(spec|test|e2e-spec).[jt]s?(x)'],
  coverageDirectory: '../../coverage/ptah-license-server-e2e',
  // Exclude the legacy live-server smoke spec from default runs; it boots
  // only when explicitly requested via RUN_LIVE_E2E=1.
  testPathIgnorePatterns: runLive ? [] : ['/src/ptah-license-server/'],
};

export default runLive
  ? {
      ...base,
      globalSetup: '<rootDir>/src/support/global-setup.ts',
      globalTeardown: '<rootDir>/src/support/global-teardown.ts',
      setupFiles: ['<rootDir>/src/support/test-setup.ts'],
    }
  : base;
