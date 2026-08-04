module.exports = {
  displayName: 'web-members',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/web/members',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // jest-preset-angular's setup-env entry is ESM-only, so the default
  // node_modules ignore leaves it untransformed and Jest fails on its bare
  // `import`. Same exception the other web libs carry.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|jest-preset-angular))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
