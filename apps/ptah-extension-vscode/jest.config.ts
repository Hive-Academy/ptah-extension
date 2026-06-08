export default {
  displayName: 'ptah-extension-vscode',
  preset: '../../jest.preset.js',
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
  coverageDirectory: '../../coverage/apps/ptah-extension-vscode',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../__mocks__/vscode.ts',
    '(^|/)wasm-bundle-dir(\\.js)?$': '<rootDir>/__mocks__/wasm-bundle-dir.ts',
  },
};
