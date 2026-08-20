export default {
  displayName: 'voice-providers',
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
  coverageDirectory: '../../../coverage/libs/backend/voice-providers',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
};
