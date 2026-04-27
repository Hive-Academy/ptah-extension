export default {
  displayName: 'shared',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/shared',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 88.37 / B 89.5 /
  // F 73.33 / L 87.6). Rounded down to the nearest 5 so minor variation
  // doesn't flake CI. Raise only when a new wave lifts the baseline.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 85,
      functions: 70,
      lines: 85,
    },
  },
};
