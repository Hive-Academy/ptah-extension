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
  // Ratchet floor after TASK_2025_294 F6 (agent-generation test
  // stabilization). Post-fix baseline measured: S 87.86 / B 72.66 /
  // F 87.61 / L 88.02 (246 tests passing, 7 skipped). Floor rounded
  // down to the nearest 5, never exceeding actual.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 85,
      lines: 85,
    },
  },
};
