export default {
  displayName: 'plugin-marketplace',
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
  coverageDirectory: '../../../coverage/libs/backend/plugin-marketplace',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
};
