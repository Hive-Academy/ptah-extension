export default {
  displayName: 'llm-abstraction',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/llm-abstraction',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 59.42 / B 40.37 /
  // F 64.1 / L 60.82). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 40,
      functions: 60,
      lines: 60,
    },
  },
};
