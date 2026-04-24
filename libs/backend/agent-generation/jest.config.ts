export default {
  displayName: 'agent-generation',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/agent-generation',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 86.1 / B 72.07 /
  // F 85.48 / L 86.45). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 85,
      lines: 85,
    },
  },
};
