export default {
  displayName: 'platform-electron',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/platform-electron',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 92.49 / B 78.53 /
  // F 90.0 / L 93.71). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 75,
      functions: 90,
      lines: 90,
    },
  },
};
