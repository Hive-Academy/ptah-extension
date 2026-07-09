export default {
  displayName: 'editor',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/editor',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  moduleNameMapper: {
    // ngx-markdown (+ its `marked` dep) ship ESM the transform can't compile;
    // any spec reaching CodeEditorComponent needs a stub. Mapped at resolution
    // time so it works transitively (see the stub file for details). Specs may
    // still `jest.mock('ngx-markdown', ...)` — that takes precedence.
    '^ngx-markdown$': '<rootDir>/src/testing/ngx-markdown.stub.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
