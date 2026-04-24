export default {
  displayName: 'vscode-core',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/vscode-core',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 90.9 / B 78.4 /
  // F 86.0 / L 91.38). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 75,
      functions: 85,
      lines: 90,
    },
  },
};
