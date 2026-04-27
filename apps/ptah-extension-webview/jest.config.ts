export default {
  displayName: 'ptah-extension-webview',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/ptah-extension-webview',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // Allow marked + ngx-markdown through ts-jest; both ship pure-ESM
  // entrypoints that the default CJS transform refuses to parse.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|marked|ngx-markdown))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
  // F10 post-fix baseline (smoke-only, 1 spec): S 18 / B 0 / F 0 / L 14.58.
  // The webview app is a thin bootstrap around AppStateManager,
  // VSCodeService, and WebviewNavigationService; its integration
  // coverage lives in @ptah-extension/chat and @ptah-extension/core.
  // Floor parks at the minimum passing level to catch total regressions
  // without pretending this app owns exercised surface. Raise once a
  // DI-mocking harness is introduced.
  coverageThreshold: {
    global: {
      statements: 15,
      branches: 0,
      functions: 0,
      lines: 10,
    },
  },
};
