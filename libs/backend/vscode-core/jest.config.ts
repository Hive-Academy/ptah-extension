export default {
  displayName: 'vscode-core',
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
  coverageDirectory: '../../../coverage/libs/backend/vscode-core',
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 50,
      functions: 70,
      lines: 65,
    },
  },
};
