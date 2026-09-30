module.exports = {
  displayName: 'web-auth',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/web/auth',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // `@jsverse/*` (Transloco, behind `@ptah-extension/i18n`) and
  // `@angular/common/locales/*` (registered by the i18n runtime) ship plain
  // `.js` ESM, which the default `.mjs`-only exception leaves untransformed.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|@jsverse|@angular/common/locales))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
