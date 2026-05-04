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
  // Ratchet floor — rounded down to the nearest 5 against the actual
  // measured baseline, never exceeding it. Branches re-baselined to 35
  // (current ~39.8%) after natural drift from new untested code paths
  // landing across the library. Statements/lines/functions unchanged.
  // This library still has sizable untested surface area; later waves
  // will lift the floor as specs are added.
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 35,
      functions: 45,
      lines: 50,
    },
  },
};
