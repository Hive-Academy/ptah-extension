export default {
  displayName: 'cli-agent-runtime',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // `@agentclientprotocol/sdk` ships ESM only; ts-jest transpiles it to CommonJS for the specs.
  transformIgnorePatterns: ['node_modules/(?!@agentclientprotocol/)'],
  coverageDirectory: '../../../coverage/libs/backend/cli-agent-runtime',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
};
