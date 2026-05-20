export default {
  displayName: 'vscode-lm-tools',
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
  coverageDirectory: '../../../coverage/libs/backend/vscode-lm-tools',
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 60,
      functions: 85,
      lines: 75,
    },
  },
};
