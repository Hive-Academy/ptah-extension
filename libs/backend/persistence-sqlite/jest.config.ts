export default {
  displayName: 'persistence-sqlite',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '\\.sql$': '<rootDir>/../../../jest.sql-transform.js',
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'sql'],
  coverageDirectory: '../../../coverage/libs/backend/persistence-sqlite',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
};
