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
};
