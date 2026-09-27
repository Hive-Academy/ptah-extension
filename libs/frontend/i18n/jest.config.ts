export default {
  displayName: 'i18n',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/i18n',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // `@jsverse/utils` (a Transloco dependency) ships `"type": "module"` with
  // plain `.js` files, so the default `.mjs`-only exception would leave it
  // untransformed and Jest would choke on its bare `import`.
  transformIgnorePatterns: ['node_modules/(?!(?:.*\\.mjs$|@jsverse))'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
