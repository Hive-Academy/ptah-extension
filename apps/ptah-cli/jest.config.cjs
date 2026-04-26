module.exports = {
  displayName: 'ptah-cli',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  coverageDirectory: '../../coverage/apps/ptah-cli',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../__mocks__/vscode.ts',
    // Static `CliDIContainer` import in `with-engine.ts` pulls in the
    // workspace-intelligence transitive graph, which loads `wasm-bundle-dir`
    // — a module that uses `import.meta` and cannot be parsed by Jest's CJS
    // loader. Redirect to a stub; AST/tree-sitter is not exercised in CLI
    // unit tests.
    'wasm-bundle-dir(\\.js)?$': '<rootDir>/../../__mocks__/wasm-bundle-dir.ts',
  },
};
