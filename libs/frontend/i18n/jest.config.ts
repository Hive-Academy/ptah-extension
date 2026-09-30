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
  // plain `.js` files, and so does `@angular/common/locales/*` (registered by
  // `provideI18n`), so the default `.mjs`-only exception would leave them
  // untransformed and Jest would choke on their bare `import`/`export`.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|@jsverse|@angular/common/locales))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
