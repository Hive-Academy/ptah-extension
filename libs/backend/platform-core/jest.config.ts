export default {
  displayName: 'platform-core',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/platform-core',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 88.53 / B 67.23 /
  // F 92.92 / L 88.33). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 65,
      functions: 90,
      lines: 85,
    },
  },
};
