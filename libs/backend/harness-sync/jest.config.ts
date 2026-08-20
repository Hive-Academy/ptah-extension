export default {
  displayName: 'harness-sync',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
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
  setupFiles: ['reflect-metadata'],
  coverageDirectory: '../../../coverage/libs/backend/harness-sync',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
};
