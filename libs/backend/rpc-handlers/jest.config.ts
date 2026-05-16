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
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 40,
      functions: 69,
      lines: 65,
    },
  },
};
