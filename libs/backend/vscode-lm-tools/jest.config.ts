export default {
  displayName: 'vscode-lm-tools',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/vscode-lm-tools',
  // No specs landed yet (W8.B1 baseline: 0%). A 5% floor catches future
  // regressions the moment the first real spec lands; raise as coverage
  // grows in later waves.
  coverageThreshold: {
    global: {
      statements: 5,
      branches: 5,
      functions: 5,
      lines: 5,
    },
  },
};
