export default {
  displayName: 'marketplace',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/marketplace',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // `providers.registry.ts` pulls in `@ptah-extension/chat-ui`, which reaches
  // `ngx-markdown` — ESM that jest cannot parse untransformed. Same mock +
  // transform allowance already used by dashboard, tasks-ui and thoth-shell.
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
};
