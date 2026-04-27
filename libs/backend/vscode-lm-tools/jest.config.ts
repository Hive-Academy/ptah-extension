export default {
  displayName: 'vscode-lm-tools',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/vscode-lm-tools',
  // Post-P1 baseline (TASK_2026_100 Phase 2 Wave P1: 26 suites / 453 tests).
  // Measured: S 78.36 / B 61.71 / F 86.49 / L 78.95. Floors round down to
  // nearest 5; raise only after future waves widen coverage.
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 60,
      functions: 85,
      lines: 75,
    },
  },
};
