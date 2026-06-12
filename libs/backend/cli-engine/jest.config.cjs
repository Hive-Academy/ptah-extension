module.exports = {
  displayName: 'cli-engine',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/cli-engine',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
    '(^|/)wasm-bundle-dir(\\.js)?$': '<rootDir>/__mocks__/wasm-bundle-dir.ts',
  },
};
