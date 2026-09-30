module.exports = {
  displayName: 'web-admin',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/web/admin',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // FullCalendar v7 ships `"type": "module"` with plain `.js` files, so the
  // default `.mjs`-only exception leaves it untransformed and Jest chokes on
  // its bare `import`. Its preact/temporal deps are ESM-only for the same reason,
  // as are `@jsverse/*` (Transloco, behind `@ptah-extension/i18n`) and
  // `@angular/common/locales/*` (registered by the i18n runtime).
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|@fullcalendar|fullcalendar|@full-ui|preact|temporal-polyfill|temporal-spec|temporal-utils|@jsverse|@angular/common/locales))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
