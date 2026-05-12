export default {
  displayName: 'rpc-handlers',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/rpc-handlers',
  // Handler files transitively import `@ptah-extension/agent-sdk` and
  // `@ptah-extension/vscode-core`, both of which pull in real `vscode` typings.
  // Swap `vscode` for the shared root mock so specs can run under Node.
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 66.75 / B 41.42 /
  // F 74.62 / L 67.2). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 40,
      functions: 69,
      lines: 65,
    },
  },
};
