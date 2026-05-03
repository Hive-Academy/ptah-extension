export default {
  displayName: 'persistence-sqlite',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/persistence-sqlite',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
};
