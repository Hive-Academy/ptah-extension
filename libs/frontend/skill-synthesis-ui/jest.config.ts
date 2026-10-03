export default {
  displayName: 'skill-synthesis-ui',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/skill-synthesis-ui',
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
    // The diff renderer is reached through a runtime import() so the Skills
    // tab never inherits the git-ui bundle. Under jsdom that entry would drag
    // in @pierre/diffs; stub it instead.
    '^@ptah-extension/git-ui/diff-renderer$':
      '<rootDir>/src/__mocks__/ptah-git-ui-diff-renderer.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
