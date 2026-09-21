/**
 * Shared Jest preset for every `libs/api/*` project.
 *
 * It exists for ONE reason: NestJS 12 is ESM-only (`type: module` across the
 * whole family), while these specs still compile to CommonJS through
 * `tsconfig.spec.json`. A CommonJS test cannot `require()` an ESM package
 * unless Jest is allowed to evaluate ESM synchronously.
 *
 * Jest 30 gates that on one capability check (`jest-runtime`,
 * `internals/nodeCapabilities`):
 *
 *   supportsSyncEvaluate =
 *     typeof vm.SourceTextModule?.prototype.hasAsyncGraph === 'function'
 *
 * `vm.SourceTextModule` only exists under `--experimental-vm-modules`. Measured
 * on Node 24.15.0: without the flag both are `undefined`; with it both are
 * `function`. Node itself can already `require()` an ESM package here — it is
 * Jest's own module registry that refuses, not Node.
 *
 * Without the flag the failure reads `Must use import to load ES Module:
 * .../@nestjs/common/index.js`, which points at a dependency rather than at the
 * missing flag. The npm test scripts set it, but a bare `nx test api-email`
 * does not, and `.env` cannot supply it because Jest runs in-process and
 * NODE_OPTIONS is read at process start. So this preset checks the capability
 * directly and fails with the command to run.
 *
 * Do NOT "fix" this with `transformIgnorePatterns` over `@nestjs/*`. Measured:
 * ts-jest then transforms `@nestjs/common/index.js` but not the files it pulls
 * in, and the same error simply reappears one level deeper
 * (`@nestjs/common/utils/load-package.util.js`).
 */

const vm = require('node:vm');

if (typeof vm.SourceTextModule?.prototype?.hasAsyncGraph !== 'function') {
  throw new Error(
    [
      'libs/api tests need Node to expose vm.SourceTextModule.',
      '',
      'NestJS 12 is ESM-only and these specs compile to CommonJS, so Jest must',
      'be allowed to evaluate ESM synchronously. Re-run with:',
      '',
      '  NODE_OPTIONS=--experimental-vm-modules nx test <project>',
      '',
      'or use an npm script (npm test, npm run test:all), which set it for you.',
    ].join('\n'),
  );
}

/**
 * Every setting that all `libs/api/*` projects share lives here; each
 * `jest.config.cts` keeps only what genuinely differs (`displayName` and
 * `coverageDirectory`). `<rootDir>` below resolves per consuming project,
 * not to this preset's own directory — Jest merges the preset into the
 * project config and the project's rootDir wins, so ts-jest reads
 * `<project>/tsconfig.spec.json`, never `libs/api/tsconfig.spec.json`.
 */
module.exports = {
  ...require('../../jest.preset.js'),
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
};
