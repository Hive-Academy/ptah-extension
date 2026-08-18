/**
 * Jest config for the pseudo-terminal suite — `nx run ptah-cli:e2e-pty`.
 *
 * Separate from `jest.e2e.config.cjs` for exactly one reason: `forceExit`.
 *
 * node-pty's `WindowsPtyAgent` leaves a PIPEWRAP open after the child process
 * has exited, and no public API releases it — `kill()` on an already-dead pty
 * does not help and makes node-pty spawn a console-list agent that prints
 * `AttachConsole failed` into the output. Without `forceExit` the runner hangs
 * past the last spec and CI waits on it.
 *
 * The JSON-RPC e2e suite does NOT get `forceExit`, and that is the point of
 * splitting: those specs clean up their children properly today, and a
 * workspace-wide `forceExit` would silently absorb it the day one stops.
 *
 * Everything else matches the e2e config: same preset, same dist-bundle
 * `globalSetup` guard, `maxWorkers: 1` because a pty binds a real console.
 * The timeout is higher — a TUI spec pays full DI bootstrap AND waits for
 * several settled repaints.
 */

module.exports = {
  displayName: 'ptah-cli-pty',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/e2e/**/*.pty.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
  globalSetup: '<rootDir>/tests/e2e/_harness/global-setup.cjs',
  testTimeout: 180_000,
  maxWorkers: 1,
  forceExit: true,
  verbose: true,
};
