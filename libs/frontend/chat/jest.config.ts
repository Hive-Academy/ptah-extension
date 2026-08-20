export default {
  displayName: 'chat',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/chat',
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
  // `ngx-markdown` dies on `Unexpected token 'export'`. Named explicitly so
  // component-level specs (e.g. agent-monitor-panel) can render.
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$|marked|ngx-markdown))'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
  coverageThreshold: {
    global: {
      statements: 35,
      branches: 25,
      functions: 35,
      lines: 35,
    },
  },
};
