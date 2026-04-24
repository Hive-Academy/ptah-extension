export default {
  displayName: 'core',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/frontend/core',
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
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 89.3 / B 76.69 /
  // F 82.05 / L 90.04). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 75,
      functions: 80,
      lines: 90,
    },
  },
};
