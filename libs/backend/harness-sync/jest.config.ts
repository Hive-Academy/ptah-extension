export default {
  displayName: 'harness-sync',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  /**
   * Jest's 5 s default is too tight for THIS lib specifically, and raising it
   * hides nothing.
   *
   * Almost every spec here reconciles a real workspace on a real filesystem:
   * a temp tree, a user layer, and up to six target directories each written,
   * hashed and re-hashed. That is hundreds of file operations per test, and on
   * Windows each one carries a virus scanner. The suite runs in ~9 s serially,
   * but under a `nx run-many` that has test, typecheck and lint competing for
   * the same box, individual tests were tipping past 5 s and failing as
   * "Exceeded timeout" — a red build for machine load, in tests that assert
   * nothing about time.
   *
   * 20 s is still far below anything a genuine hang would take, so a real
   * deadlock (a lock never released, a promise never settled) still fails
   * rather than hanging the run.
   */
  testTimeout: 20_000,
  setupFiles: ['reflect-metadata'],
  coverageDirectory: '../../../coverage/libs/backend/harness-sync',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
};
