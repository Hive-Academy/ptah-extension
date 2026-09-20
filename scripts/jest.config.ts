/**
 * Jest config for `scripts/` — run with `npm run test:scripts`.
 *
 * The root `jest.config.ts` is `{ projects: await getJestProjectsAsync() }`,
 * which enumerates NX PROJECTS ONLY. `scripts/` has no `project.json`, so it is
 * invisible to `npm run test`, `nx run-many -t test` and CI alike. Without this
 * file `scripts/drain-observation-queue.spec.ts` never runs anywhere, and an
 * un-run spec rots into a false green.
 *
 * A standalone config plus an npm script is deliberate, rather than minting an
 * Nx project for `scripts/`: it needs no `project.json`, and therefore no
 * `npx nx reset` before the target can be trusted.
 *
 * `maxWorkers: 1` is load-bearing. Every spec here creates a REAL better-sqlite3
 * database under the OS temp directory, opens it in WAL mode, takes an online
 * backup of it and holds a second connection on `BEGIN IMMEDIATE` to prove the
 * write-lock probe. Parallel workers would multiply those file handles and the
 * backup I/O for no gain — the suite is I/O bound, not CPU bound — and matches
 * the `maxWorkers: 1` the two `apps/ptah-cli` harness configs already pin for
 * the same class of reason.
 */

import type { Config } from 'jest';

const config: Config = {
  displayName: 'scripts',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  // `rootDir` is deliberately absent: Jest defaults it to the directory holding
  // this config, which is `scripts/`. Spelling it as `__dirname` does not work —
  // Jest 30 loads a TypeScript config as an ES module, where `__dirname` is not
  // defined.
  // Relative, not `<rootDir>/...`: on Windows the expanded `<rootDir>` comes
  // back with mixed `/` and `\` separators and the glob then matches nothing.
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'mjs', 'cjs', 'json'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 120_000,
  maxWorkers: 1,
};

export default config;
