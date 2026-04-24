export default {
  displayName: 'setup-wizard',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/setup-wizard',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|marked|ngx-markdown))',
  ],
  moduleNameMapper: {
    '^ngx-markdown$': '<rootDir>/src/__mocks__/ngx-markdown.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
  // F8 post-fix baseline: Statements 37.84 / Branches 17.50 / Functions
  // 25.86 / Lines 38.09 (162 passing tests, 101 skipped with rationale).
  // Floors rounded DOWN to nearest 5 to catch regressions without
  // flapping on minor refactors. Raise once the 3 skipped suites
  // (scan-progress, agent-selection, completion) are rewritten.
  coverageThreshold: {
    global: {
      statements: 35,
      branches: 15,
      functions: 25,
      lines: 35,
    },
  },
};
