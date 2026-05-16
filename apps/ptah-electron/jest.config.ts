export default {
  displayName: 'ptah-electron',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/ptah-electron',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../__mocks__/vscode.ts',
    '^electron$': '<rootDir>/__mocks__/electron.ts',
    // Static `@ptah-extension/rpc-handlers` import in DI smoke tests pulls in
    // workspace-intelligence transitively, which loads `wasm-bundle-dir` — a
    // module that uses `import.meta` and cannot be parsed by Jest's CJS
    // loader. Anchored on the left with `(^|/)` so unrelated future modules
    // are not silently rerouted.
    '(^|/)wasm-bundle-dir(\\.js)?$': '<rootDir>/__mocks__/wasm-bundle-dir.ts',
  },
};
