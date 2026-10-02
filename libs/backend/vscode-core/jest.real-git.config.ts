import base from './jest.config';

// Serial-only config for the `*.real-git.spec.ts` suites (target:
// `test-real-git`). The default `test` target ignores these files.
// No coverageThreshold: this subset cannot meet the project-wide gate.
const { coverageThreshold: _coverageThreshold, ...rest } = base;

export default {
  ...rest,
  displayName: 'vscode-core-real-git',
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/*.real-git.spec.ts'],
  coverageDirectory: '../../../coverage/libs/backend/vscode-core-real-git',
};
