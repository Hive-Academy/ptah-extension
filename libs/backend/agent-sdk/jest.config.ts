export default {
  displayName: 'agent-sdk',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/agent-sdk',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 58.17 / B 43.14 /
  // F 41.91 / L 58.4). Rounded down to the nearest 5. This library still
  // has sizable untested surface area — later waves will lift the floor.
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 40,
      functions: 40,
      lines: 55,
    },
  },
};
