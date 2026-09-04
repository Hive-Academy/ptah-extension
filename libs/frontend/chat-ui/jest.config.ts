export default {
  displayName: 'chat-ui',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/chat-ui',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // `marked` ships ESM from a `.js` file, so the default `.mjs`-only allowance
  // leaves it untransformed and any spec that instantiates a component reaching
  // `ngx-markdown` dies on `Unexpected token 'export'`. Named explicitly, same
  // as libs/frontend/chat, so component-level specs (e.g. code-output) run.
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$|marked|ngx-markdown))'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 50,
      functions: 40,
      lines: 50,
    },
  },
};
