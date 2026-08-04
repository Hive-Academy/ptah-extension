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
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../__mocks__/vscode.ts',
    // Static `CliDIContainer` import in `with-engine.ts` pulls in the
    // workspace-intelligence transitive graph, which loads `wasm-bundle-dir`
    // — a module that uses `import.meta` and cannot be parsed by Jest's CJS
    // loader. Redirect to a project-scoped stub; AST/tree-sitter is not
    // exercised in CLI unit tests.
    //
    // Pattern is anchored on the left with `(^|/)` so a hypothetical future
    // module named e.g. `something-wasm-bundle-dir.ts` does NOT silently
    // resolve to the stub. Matches:
    //   - bare specifier `wasm-bundle-dir`
    //   - relative `./wasm-bundle-dir`, `../ast/wasm-bundle-dir`
    //   - compiled `.js` variant on either form
    // Real consumer: libs/backend/workspace-intelligence/src/ast/wasm-bundle-dir.ts
    // imported via `./wasm-bundle-dir` from tree-sitter-parser.service.ts.
    '(^|/)wasm-bundle-dir(\\.js)?$':
      '<rootDir>/__mocks__/wasm-bundle-dir.ts',
  },
};
