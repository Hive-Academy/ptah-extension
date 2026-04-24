export default {
  displayName: 'workspace-intelligence',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/workspace-intelligence',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 86.15 / B 74.7 /
  // F 90.53 / L 85.84). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 90,
      lines: 85,
    },
  },
};
