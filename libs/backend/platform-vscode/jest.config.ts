export default {
  displayName: 'platform-vscode',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    // The `vscode` package is only available at runtime inside the extension
    // host. Tests route to our stateful in-memory test double so contract
    // specs can assert real round-trip behaviour.
    '^vscode$': '<rootDir>/__mocks__/vscode.ts',
  },
  coverageDirectory: '../../../coverage/libs/backend/platform-vscode',
};
